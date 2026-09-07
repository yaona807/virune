import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { compileSource, type JsInteropProvider } from '@virune/compiler/experimental';
import { TypeScriptInteropProvider } from '../src/index.js';
import { fixtureRoot } from './fixture.js';

const declarations = `declare global {
	namespace JSX {
		interface Element { readonly __viruneJsxElement: unique symbol; }
		interface ElementChildrenAttribute { children: {}; }
		interface IntrinsicElements {
			panel: { tone: "warm"; label?: string; "data-state"?: "ready"; children?: string };
		}
	}
}

export declare function Card(props: { label: "ok"; children?: string }): JSX.Element;
export declare const ui: {
	Tile: (props: { tone: "warm" }) => JSX.Element;
};
`;

async function project() {
	const root = await fixtureRoot();
	await writeFile(join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { jsx: 'preserve' }, include: ['src/**/*'] }), 'utf8');
	await writeFile(join(root, 'src/library.d.ts'), declarations, 'utf8');
	await writeFile(join(root, 'src/library.js'), 'export const Card = () => null; export const ui = { Tile: () => null };\n', 'utf8');
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
	const accepted = await compile(`import js { Card } from "./library.js"

component Page(label: String) uses JavaScript {
	return view {
		panel(tone: "warm", label: label, "data-state": "ready") {
			"hello"
		}
	}
}
`);
	assert.deepEqual(errors(accepted), []);

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
});

test('View JSX validation fails closed for unsupported native aggregate values', async () => {
	const result = await compile(`import js { Card } from "./library.js"

record Config {
	label: String
}

component Page(config: Config) uses JavaScript {
	return view {
		panel(tone: "warm", label: config)
	}
}
`);
	const diagnostic = errors(result).find(item => item.code === 'L4308');
	assert.ok(diagnostic);
	assert.match(diagnostic.message, /requires a boundary not implemented/u);
});

test('a supplied provider without JSX whole-usage support cannot approve a component', () => {
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
	const result = compileSource({
		id: 1,
		path: 'frontend.virune',
		text: `component Page() uses JavaScript {
	return view {
		panel(tone: "warm")
	}
}
`,
	}, { emit: false, platform: 'browser', jsInteropProvider: provider });
	assert.ok(result.diagnostics.some(item => item.severity === 'error' && item.code === 'L4308' && /does not support JSX whole-usage validation/u.test(item.message)));
});
