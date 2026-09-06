import assert from 'node:assert/strict';
import test from 'node:test';
import { compileSource } from '../src/compiler.js';
import type { ComponentDeclaration, ReturnStatement, ViewElement, ViewExpression } from '../src/ast/nodes.js';

const source = (text: string) => ({ id: 1, path: 'frontend.virune', text });
const errorCodes = (text: string): readonly string[] => compileSource(source(text), { emit: false }).diagnostics
	.filter(item => item.severity === 'error')
	.map(item => item.code);

// @virune-rule {"id":"frontend.component-declaration","runner":"unit","file":"packages/compiler/test/frontend-component-view.test.ts","case":"component and View syntax preserves framework-neutral structure","kind":"positive","platform":"common"}
// @virune-rule {"id":"frontend.component-effects","runner":"unit","file":"packages/compiler/test/frontend-component-view.test.ts","case":"component and View syntax preserves framework-neutral structure","kind":"positive","platform":"common"}
// @virune-rule {"id":"frontend.view-elements","runner":"unit","file":"packages/compiler/test/frontend-component-view.test.ts","case":"component and View syntax preserves framework-neutral structure","kind":"positive","platform":"common"}
// @virune-rule {"id":"frontend.view-properties","runner":"unit","file":"packages/compiler/test/frontend-component-view.test.ts","case":"component and View syntax preserves framework-neutral structure","kind":"positive","platform":"common"}
// @virune-rule {"id":"frontend.view-children","runner":"unit","file":"packages/compiler/test/frontend-component-view.test.ts","case":"component and View syntax preserves framework-neutral structure","kind":"positive","platform":"common"}
// @virune-rule {"id":"frontend.view-conditional","runner":"unit","file":"packages/compiler/test/frontend-component-view.test.ts","case":"component and View syntax preserves framework-neutral structure","kind":"positive","platform":"common"}
// @virune-rule {"id":"frontend.framework-neutral","runner":"unit","file":"packages/compiler/test/frontend-component-view.test.ts","case":"component and View syntax preserves framework-neutral structure","kind":"positive","platform":"common"}
test('component and View syntax preserves framework-neutral structure', () => {
	const result = compileSource(source(`internal record User {
	name: String
}

internal component UserCard(user: User) uses JavaScript {
	return view {
		main(class: "page", "data-state": user.name) {
			"User: "
			= user.name
			if true {
				ui.Button(onClick: user.name)
			} else {
				span()
			}
			children
		}
	}
}
`), { emit: false });
	assert.deepEqual(result.diagnostics.filter(item => item.severity === 'error'), []);
	const component = result.ast?.declarations.find((declaration): declaration is ComponentDeclaration => declaration.kind === 'ComponentDeclaration');
	assert.ok(component);
	assert.equal(component.public, false);
	assert.equal(component.internal, true);
	assert.deepEqual(component.effects, ['JavaScript']);
	const returned = component.body.statements[0] as ReturnStatement;
	assert.equal(returned.kind, 'ReturnStatement');
	assert.equal(returned.value?.kind, 'ViewExpression');
	const view = returned.value as ViewExpression;
	const main = view.body.children[0] as ViewElement;
	assert.equal(main.kind, 'ViewElement');
	assert.deepEqual(main.tag, ['main']);
	assert.deepEqual(main.properties.map(property => [property.name, property.quoted]), [['class', false], ['data-state', true]]);
	assert.equal(main.children?.children[0]?.kind, 'ViewTextChild');
	assert.equal(main.children?.children[1]?.kind, 'ViewExpressionChild');
	assert.equal(main.children?.children[2]?.kind, 'ViewConditional');
	assert.equal(main.children?.children[3]?.kind, 'ViewChildrenSlot');
	const conditional = main.children?.children[2];
	assert.equal(conditional?.kind, 'ViewConditional');
	if (conditional?.kind !== 'ViewConditional') throw new Error('expected ViewConditional');
	const button = conditional.thenBlock.children[0] as ViewElement;
	assert.deepEqual(button.tag, ['ui', 'Button']);
});

// @virune-rule {"id":"frontend.component-visibility","runner":"unit","file":"packages/compiler/test/frontend-component-view.test.ts","case":"public components fail closed and JavaScript effect is explicit","kind":"negative","platform":"common"}
// @virune-rule {"id":"frontend.component-effects","runner":"unit","file":"packages/compiler/test/frontend-component-view.test.ts","case":"public components fail closed and JavaScript effect is explicit","kind":"negative","platform":"common"}
test('public components fail closed and JavaScript effect is explicit', () => {
	assert.ok(errorCodes(`pub component PublicCard() uses JavaScript {
	return view {
		main()
	}
}
`).includes('L4301'));
	assert.ok(errorCodes(`component NoJavaScript() uses Console {
	return view {
		main()
	}
}
`).includes('L4302'));
	assert.ok(errorCodes(`component OpenEffects() uses JavaScript, * {
	return view {
		main()
	}
}
`).includes('L2113'));
	assert.deepEqual(errorCodes(`component ConcreteEffects() uses JavaScript, Console {
	return view {
		main()
	}
}
`), []);
});

// @virune-rule {"id":"frontend.component-declaration","runner":"unit","file":"packages/compiler/test/frontend-component-view.test.ts","case":"unsupported component modifiers and named return syntax remain absent","kind":"negative","platform":"common"}
test('unsupported component modifiers and named return syntax remain absent', () => {
	for (const text of [
		`async component Card() uses JavaScript {\n\treturn view {\n\t\tmain()\n\t}\n}\n`,
		`component Card<T>() uses JavaScript {\n\treturn view {\n\t\tmain()\n\t}\n}\n`,
		`component Card() -> String uses JavaScript {\n\treturn view {\n\t\tmain()\n\t}\n}\n`,
	]) assert.ok(errorCodes(text).includes('L0002'));
});

// @virune-rule {"id":"frontend.view-containment","runner":"unit","file":"packages/compiler/test/frontend-component-view.test.ts","case":"View and native components cannot escape into ordinary value semantics","kind":"negative","platform":"common"}
test('View and native components cannot escape into ordinary value semantics', () => {
	assert.ok(errorCodes(`fn leak() -> Unit uses JavaScript {
	return view {
		main()
	}
}
`).includes('L4300'));
	assert.ok(errorCodes(`fn store() -> Unit uses JavaScript {
	let leaked = view {
		main()
	}
	return Unit
}
`).includes('L4300'));
	assert.ok(errorCodes(`component Child() uses JavaScript {
	return view {
		span()
	}
}

fn callChild() -> Unit uses JavaScript {
	Child()
	return Unit
}
`).includes('L4305'));
});

test('component returns are direct View values on every path', () => {
	assert.ok(errorCodes(`component Wrong() uses JavaScript {
	return Unit
}
`).includes('L4303'));
	assert.ok(errorCodes(`component Partial(flag: Bool) uses JavaScript {
	if flag {
		return view {
			main()
		}
	}
}
`).includes('L4304'));
});

// @virune-rule {"id":"frontend.children-slot","runner":"unit","file":"packages/compiler/test/frontend-component-view.test.ts","case":"children is a single compiler-managed View slot","kind":"negative","platform":"common"}
test('children is a single compiler-managed View slot', () => {
	assert.ok(errorCodes(`component Panel() uses JavaScript {
	return view {
		section() {
			children
			children
		}
	}
}
`).includes('L4306'));
	const ordinary = compileSource(source(`record Box {
	children: Int
}

fn preserveChildren(children: Int) -> Int {
	let mut value = children
	value = value + 1
	let box = Box { children: value }
	return box.children
}
`), { emit: false });
	assert.deepEqual(ordinary.diagnostics.filter(item => item.severity === 'error'), []);
});

// @virune-rule {"id":"frontend.no-generic-repetition","runner":"unit","file":"packages/compiler/test/frontend-component-view.test.ts","case":"generic View repetition syntax is not part of the grammar","kind":"negative","platform":"common"}
test('generic View repetition syntax is not part of the grammar', () => {
	assert.ok(errorCodes(`component ListView(items: List<Int>) uses JavaScript {
	return view {
		for item in items {
			span()
		}
	}
}
`).includes('L0002'));
});

test('single-file component emission fails closed before ordinary JavaScript output', () => {
	const result = compileSource(source(`component Card() uses JavaScript {
	return view {
		main()
	}
}
`));
	assert.ok(result.diagnostics.some(item => item.code === 'L4307' && item.severity === 'error'));
	assert.equal(result.output, undefined);
});
