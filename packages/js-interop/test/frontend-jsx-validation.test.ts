import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { buildProject, compileSource, type JsInteropProvider } from '@virune/compiler/experimental';
import { TypeScriptInteropProvider } from '../src/index.js';
import { fixtureRoot } from './fixture.js';

const declarations = `declare global {
	namespace JSX {
		interface Element { readonly __viruneJsxElement: unique symbol; }
		interface ElementChildrenAttribute { children: {}; }
		interface IntrinsicElements {
			panel: { tone: "warm"; count?: -1; label?: string; "data-state"?: "ready"; children?: string };
			child: {};
		}
	}
	function h(type: string, props: object | null): JSX.Element;
	const AmbientCard: (props: { label: "ambient" }) => JSX.Element;
}

export interface Marker { readonly marker: true; }
export declare function Card(props: { label: "ok"; children?: string }): JSX.Element;
export declare function child(props: { imported: "yes" }): JSX.Element;
export declare const ui: {
	Tile: (props: { tone: "warm" }) => JSX.Element;
};
`;

async function project() {
	const root = await fixtureRoot();
	await writeFile(join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { jsx: 'preserve', noUnusedLocals: true }, include: ['src/**/*'] }), 'utf8');
	await writeFile(join(root, 'src/library.d.ts'), declarations, 'utf8');
	await writeFile(join(root, 'src/library.js'), 'export const Card = () => null; export const child = () => null; export const ui = { Tile: () => null };\n', 'utf8');
	return root;
}

async function compile(text: string) {
	const root = await project();
	const provider = new TypeScriptInteropProvider({ projectRoot: root });
	try {
		return compileSource({ id: 1, path: join(root, 'src/main.virune'), text }, { emit: false, platform: 'browser', jsInteropProvider: provider });
	} finally {
		provider.dispose();
	}
}

const errors = (result: Awaited<ReturnType<typeof compile>>) => result.diagnostics.filter(item => item.severity === 'error');

test('View intrinsic usage is accepted only through the declaration-driven JSX contract', async () => {
	const accepted = await compile(`import js type { Marker } from "./library.js"
import js { Card } from "./library.js"

component Page(label: String) uses JavaScript {
	return view {
		panel(tone: "warm", count: -1, label: label, "data-state": "ready") {
			"hello"
		}
	}
}
`);
	assert.deepEqual(errors(accepted), []);

	const expressionChild = await compile(`import js { Card } from "./library.js"

component Page(label: String) uses JavaScript {
	return view {
		panel(tone: "warm") {
			= label
		}
	}
}
`);
	assert.deepEqual(errors(expressionChild), []);

	const invalidLiteral = await compile(`import js { Card } from "./library.js"

component Page() uses JavaScript {
	return view {
		panel(tone: "cold")
	}
}
`);
	assert.ok(errors(invalidLiteral).some(item => item.code === 'L4308'));

	const widenedLiteral = await compile(`import js { Card } from "./library.js"

component Page(tone: String) uses JavaScript {
	return view {
		panel(tone: tone)
	}
}
`);
	assert.ok(errors(widenedLiteral).some(item => item.code === 'L4308'));

	const invalidProperty = await compile(`import js { Card } from "./library.js"

component Page() uses JavaScript {
	return view {
		panel(tone: "warm", missing: "no")
	}
}
`);
	assert.ok(errors(invalidProperty).some(item => item.code === 'L4308'));

	const invalidTag = await compile(`import js { Card } from "./library.js"

component Page() uses JavaScript {
	return view {
		unknown(tone: "warm")
	}
}
`);
	assert.ok(errors(invalidTag).some(item => item.code === 'L4308'));
});

test('View conditionals preserve supported single-child branch value types', async () => {
	const result = await compile(`import js { Card } from "./library.js"

component Page(flag: Bool) uses JavaScript {
	return view {
		panel(tone: "warm") {
			if flag {
				"yes"
			} else {
				"no"
			}
		}
	}
}
`);
	assert.deepEqual(errors(result), []);
});

test('View External component and dotted member tags use their real TypeScript imports', async () => {
	const accepted = await compile(`import js { Card, ui } from "./library.js"

component Page() uses JavaScript {
	return view {
		Card(label: "ok") {
			"hello"
		}
		ui.Tile(tone: "warm")
	}
}
`);
	assert.deepEqual(errors(accepted), []);

	const rejected = await compile(`import js { Card } from "./library.js"

component Page() uses JavaScript {
	return view {
		Card(label: "wrong")
	}
}
`);
	assert.ok(errors(rejected).some(item => item.code === 'L4308'));

	const lowercase = await compile(`import js { child } from "./library.js"

component Page() uses JavaScript {
	return view {
		child()
	}
}
`);
	assert.ok(errors(lowercase).some(item => item.code === 'L4308' && /ambiguous with JSX intrinsic syntax/u.test(item.message)));

	const ambientOnly = await compile(`import js { Card } from "./library.js"

component Page() uses JavaScript {
	return view {
		AmbientCard(label: "ambient")
	}
}
`);
	assert.ok(errors(ambientOnly).some(item => item.code === 'L4308'));
});

test('single-element View validation does not require an unnecessary JSX fragment factory', async () => {
	const root = await project();
	await writeFile(join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { jsx: 'react', jsxFactory: 'h', noUnusedLocals: true }, include: ['src/**/*'] }), 'utf8');
	const provider = new TypeScriptInteropProvider({ projectRoot: root });
	try {
		const result = compileSource({
			id: 1,
			path: join(root, 'src/main.virune'),
			text: `component Page() uses JavaScript {
	return view {
		panel(tone: "warm")
	}
}
`,
		}, { emit: false, platform: 'browser', jsInteropProvider: provider });
		assert.deepEqual(result.diagnostics.filter(item => item.severity === 'error'), []);
	} finally {
		provider.dispose();
	}
});

test('View JSX validation fails closed for unsupported native boundaries', async () => {
	const aggregate = await compile(`import js { Card } from "./library.js"

record Config {
	label: String
}

component Page(config: Config) uses JavaScript {
	return view {
		panel(tone: "warm", label: config)
	}
}
`);
	const aggregateDiagnostic = errors(aggregate).find(item => item.code === 'L4308');
	assert.ok(aggregateDiagnostic);
	assert.match(aggregateDiagnostic.message, /requires a boundary not implemented/u);

	const unknown = await compile(`import js { Card } from "./library.js"

component Page(value: Unknown) uses JavaScript {
	return view {
		panel(tone: "warm") {
			= value
		}
	}
}
`);
	assert.ok(errors(unknown).some(item => item.code === 'L4308'));

	const callable = await compile(`import js { Card } from "./library.js"

component Page() uses JavaScript {
	return view {
		panel(tone: "warm") {
			= fn(value: String) -> String => value
		}
	}
}
`);
	assert.ok(errors(callable).some(item => item.code === 'L4308'));

	const nativeComponent = await compile(`import js { Card } from "./library.js"

component child() uses JavaScript {
	return view {
		panel(tone: "warm")
	}
}

component Page() uses JavaScript {
	return view {
		child()
	}
}
`);
	assert.ok(errors(nativeComponent).some(item => item.code === 'L4308'));
});

test('a missing or incapable JSX provider cannot approve a component', () => {
	const source = {
		id: 1,
		path: 'frontend.virune',
		text: `component Page() uses JavaScript {
	return view {
		panel(tone: "warm")
	}
}
`,
	};
	const missing = compileSource(source, { emit: false, platform: 'browser' });
	assert.ok(missing.diagnostics.some(item => item.severity === 'error' && item.code === 'L4308' && /no JavaScript interop provider is available/u.test(item.message)));

	const provider: JsInteropProvider = {
		id: 'no-jsx',
		version: '1',
		generation: 1,
		resolveImport: () => { throw new Error('unused'); },
		getProperty: () => undefined,
		resolveCall: () => undefined,
		resolveConstruct: () => undefined,
		getAwaitedType: () => undefined,
		display: () => '<unused>',
	};
	const unsupported = compileSource(source, { emit: false, platform: 'browser', jsInteropProvider: provider });
	assert.ok(unsupported.diagnostics.some(item => item.severity === 'error' && item.code === 'L4308' && /does not support JSX whole-usage validation/u.test(item.message)));
});

test('project builds reuse the same JSX oracle validation before the existing emission gate', async () => {
	const root = await project();
	const provider = new TypeScriptInteropProvider({ projectRoot: root });
	try {
		await writeFile(join(root, 'src/main.virune'), `import js { Card } from "./library.js"

component Page() uses JavaScript {
	return view {
		panel(tone: "warm")
	}
}
`, 'utf8');
		const accepted = await buildProject(root, { write: false, jsInteropProvider: provider });
		assert.equal(accepted.diagnostics.some(item => item.code === 'L4308'), false);
		assert.ok(accepted.diagnostics.some(item => item.code === 'L4307'));

		await writeFile(join(root, 'src/main.virune'), `import js { Card } from "./library.js"

component Page() uses JavaScript {
	return view {
		panel(tone: "cold")
	}
}
`, 'utf8');
		const rejected = await buildProject(root, { write: false, jsInteropProvider: provider });
		assert.ok(rejected.diagnostics.some(item => item.code === 'L4308'));
	} finally {
		provider.dispose();
	}
});
