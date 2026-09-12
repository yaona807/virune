import assert from 'node:assert/strict';
import test from 'node:test';
import type { ComponentDeclaration, ReturnStatement, ViewElement, ViewExpression } from '../src/ast/nodes.js';
import { checkModule } from '../src/checker/checker.js';
import { compileSource } from '../src/compiler.js';
import type { JsInteropProvider } from '../src/interop/types.js';
import { parseSource } from '../src/project/project.js';

const source = (text: string) => ({ id: 1, path: 'frontend.virune', text });
function checkSource(text: string) {
	const parsed = parseSource(source(text));
	if (parsed.ast === undefined || parsed.diagnostics.some(item => item.severity === 'error')) return parsed;
	const semantic = checkModule(parsed.ast, { containingFile: parsed.source.path });
	return { ...parsed, diagnostics: [...parsed.diagnostics, ...semantic.diagnostics.items] };
}
const errorCodes = (text: string): readonly string[] => checkSource(text).diagnostics
	.filter(item => item.severity === 'error')
	.map(item => item.code);
const parseErrorCodes = (text: string): readonly string[] => parseSource(source(text)).diagnostics
	.filter(item => item.severity === 'error')
	.map(item => item.code);

const jsxValidationProvider: JsInteropProvider = {
	id: 'frontend-test',
	version: '1',
	generation: 1,
	resolveImport: () => { throw new Error('unexpected import'); },
	getProperty: () => undefined,
	resolveCall: () => undefined,
	resolveConstruct: () => undefined,
	getAwaitedType: () => undefined,
	display: () => '<unused>',
	resolveJsxUsage: () => ({ accepted: true }),
};

// @virune-rule {"id":"frontend.component-declaration","runner":"unit","file":"packages/compiler/test/frontend-component-view.test.ts","case":"component and View syntax preserves framework-neutral structure","kind":"positive","platform":"common"}
// @virune-rule {"id":"frontend.component-effects","runner":"unit","file":"packages/compiler/test/frontend-component-view.test.ts","case":"component and View syntax preserves framework-neutral structure","kind":"positive","platform":"common"}
// @virune-rule {"id":"frontend.view-elements","runner":"unit","file":"packages/compiler/test/frontend-component-view.test.ts","case":"component and View syntax preserves framework-neutral structure","kind":"positive","platform":"common"}
// @virune-rule {"id":"frontend.view-properties","runner":"unit","file":"packages/compiler/test/frontend-component-view.test.ts","case":"component and View syntax preserves framework-neutral structure","kind":"positive","platform":"common"}
// @virune-rule {"id":"frontend.view-children","runner":"unit","file":"packages/compiler/test/frontend-component-view.test.ts","case":"component and View syntax preserves framework-neutral structure","kind":"positive","platform":"common"}
// @virune-rule {"id":"frontend.view-conditional","runner":"unit","file":"packages/compiler/test/frontend-component-view.test.ts","case":"component and View syntax preserves framework-neutral structure","kind":"positive","platform":"common"}
// @virune-rule {"id":"frontend.framework-neutral","runner":"unit","file":"packages/compiler/test/frontend-component-view.test.ts","case":"component and View syntax preserves framework-neutral structure","kind":"positive","platform":"common"}
test('component and View syntax preserves framework-neutral structure', () => {
	const result = checkSource(`internal record User {
	name: String
}

internal component UserCard(user: User) uses JavaScript {
	return view {
		main(class: "page", "data-state": user.name) {
			"User: "
			{ user.name }
			if true {
				ui.Button(onClick: user.name)
			} else {
				span()
			}
			children
		}
	}
}
`);
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

// @virune-rule {"id":"frontend.view-children","runner":"unit","file":"packages/compiler/test/frontend-component-view.test.ts","case":"View expression holes preserve ordinary expression grammar","kind":"positive","platform":"common"}
test('View expression holes preserve ordinary expression grammar', () => {
	for (const expression of [
		'user.name',
		'formatUser(user)',
		'if ready then value else fallback',
		'match value { Some(x) => x None => "" }',
		'{ name: user.name }',
	]) {
		const text = `component Card() uses JavaScript {\n\treturn view {\n\t\tmain() {\n\t\t\t{ ${expression} }\n\t\t}\n\t}\n}\n`;
		assert.deepEqual(parseErrorCodes(text), [], expression);
	}
});

// @virune-rule {"id":"frontend.view-children","runner":"unit","file":"packages/compiler/test/frontend-component-view.test.ts","case":"legacy and malformed View expression children fail closed","kind":"negative","platform":"common"}
test('legacy and malformed View expression children fail closed', () => {
	for (const child of [
		'= user.name',
		'{}',
		'{ user.name',
		'{ if ready then }',
		'{ user.name extra }',
	]) {
		const text = `component Card() uses JavaScript {\n\treturn view {\n\t\tmain() {\n\t\t\t${child}\n\t\t\tspan()\n\t\t}\n\t}\n}\n`;
		assert.ok(parseErrorCodes(text).length > 0, child);
	}
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
	assert.deepEqual(errorCodes(`component ChildrenTag() uses JavaScript {
	return view {
		children()
	}
}
`), []);
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

// @virune-rule {"id":"frontend.view-repetition","runner":"unit","file":"packages/compiler/test/frontend-component-view.test.ts","case":"View repetition accepts native List with source index","kind":"positive","platform":"common"}
test('View repetition accepts native List with source index', () => {
	const result = checkSource(`component ListView() uses JavaScript {
	let items = [1, 2]
	return view {
		for item, index in items {
			span(value: item)
			if true {
				strong(position: index)
			}
		}
	}
}
`);
	assert.deepEqual(result.diagnostics.filter(item => item.severity === 'error'), []);
	const component = result.ast?.declarations.find((declaration): declaration is ComponentDeclaration => declaration.kind === 'ComponentDeclaration');
	assert.ok(component);
	const returned = component.body.statements[1] as ReturnStatement;
	const view = returned.value as ViewExpression;
	const repetition = view.body.children[0];
	assert.equal(repetition?.kind, 'ViewRepetition');
	if (repetition?.kind !== 'ViewRepetition') throw new Error('expected ViewRepetition');
	assert.equal(repetition.checkedEvidence?.sourceKind, 'native-list');
	assert.ok(repetition.checkedEvidence?.itemSymbolId !== undefined);
	assert.ok(repetition.checkedEvidence?.indexSymbolId !== undefined);
	assert.equal(repetition.body.children.length, 2);
});

// @virune-rule {"id":"frontend.view-repetition-source","runner":"unit","file":"packages/compiler/test/frontend-component-view.test.ts","case":"View repetition rejects unsupported native collection sources","kind":"negative","platform":"common"}
test('View repetition rejects unsupported native collection sources', () => {
	const codes = errorCodes(`component SetView(items: Set<Int>) uses JavaScript {
	return view {
		for item, index in items {
			span(value: item, position: index)
		}
	}
}
`);
	assert.ok(codes.includes('L4310'));
	assert.ok(!codes.includes('L1009'));
});

// @virune-rule {"id":"frontend.view-repetition-children","runner":"unit","file":"packages/compiler/test/frontend-component-view.test.ts","case":"View repetition rejects nested compiler-managed children slots","kind":"negative","platform":"common"}
test('View repetition rejects nested compiler-managed children slots', () => {
	assert.ok(errorCodes(`component RepeatedChildren(items: List<Int>) uses JavaScript {
	return view {
		for item in items {
			if true {
				children
			}
		}
	}
}
`).includes('L4311'));
});
