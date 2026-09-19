import assert from 'node:assert/strict';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { buildProject } from '@virune/compiler/experimental';
import { TypeScriptInteropProvider } from '../src/index.js';
import { fixtureRoot } from './fixture.js';

const config = JSON.stringify({
	languageVersion: '1.0',
	platform: 'browser',
	sourceDir: 'src',
	outDir: 'dist',
	entry: 'src/pages/page.virune',
	target: 'es2022',
	sourceMap: true,
	sourcesContent: true,
});

const viruneSource = `import "../infra/locator.virune"

component Page() uses JavaScript {
	return view {
		for item, index in [1, 2] by item {
			span() {}
		}
	}
}
`;

const jsxDeclarations = `export {};
declare global {
	namespace JSX {
		interface Element { readonly __viruneElement: unique symbol; }
		interface IntrinsicElements {
			span: {};
			"virune-probe": {};
		}
	}
}
`;

const validHost = `export declare function render<T>(
	readSnapshot: () => Array<{ id: string; index: number; value: T }>,
	renderGroup: (readValue: () => T, readIndex: () => number, id: string) => JSX.Element,
): JSX.Element;
`;

async function runWithHost(declarations: string | undefined): Promise<{ readonly errors: readonly { readonly code: string }[]; readonly emitted: boolean }> {
	const root = await fixtureRoot();
	try {
		await mkdir(join(root, 'src/pages'), { recursive: true });
		await mkdir(join(root, 'src/infra'), { recursive: true });
		await writeFile(join(root, 'virune.json'), config, 'utf8');
		await writeFile(join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { jsx: 'preserve', strict: true }, include: ['src/**/*'] }), 'utf8');
		await writeFile(join(root, 'src/jsx.d.ts'), jsxDeclarations, 'utf8');
		await writeFile(join(root, 'src/infra/locator.virune'), '@repetitionHost("render", 1)\nextern js "./repetition-host.js" {}\n', 'utf8');
		await writeFile(join(root, 'src/pages/page.virune'), viruneSource, 'utf8');
		if (declarations !== undefined) await writeFile(join(root, 'src/infra/repetition-host.d.ts'), declarations, 'utf8');
		const provider = new TypeScriptInteropProvider({ projectRoot: root });
		try {
			const result = await buildProject(root, { write: false, jsInteropProvider: provider });
			return {
				errors: result.diagnostics.filter(item => item.severity === 'error').map(item => ({ code: item.code })),
				emitted: result.modules.some(module => module.source.path === join(root, 'src/pages/page.virune') && module.output !== undefined),
			};
		} finally {
			provider.dispose();
		}
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

test('Repetition Host whole-usage validation accepts a compatible generic TypeScript export', async () => {
	const result = await runWithHost(validHost);
	assert.deepEqual(result.errors, []);
	assert.equal(result.emitted, true);
});

test('Repetition Host whole-usage validation rejects missing and incompatible exports', async () => {
	const cases: Array<[string, string | undefined]> = [
		['missing module', undefined],
		['missing export', 'export declare const other: () => JSX.Element;\n'],
		['wrong arity', 'export declare function render(readSnapshot: () => unknown[]): JSX.Element;\n'],
		['wrong snapshot', 'export declare function render(readSnapshot: () => Array<{ key: number }>, renderGroup: (readValue: () => number, readIndex: () => number, id: string) => JSX.Element): JSX.Element;\n'],
		['wrong body id', 'export declare function render<T>(readSnapshot: () => Array<{ id: string; index: number; value: T }>, renderGroup: (readValue: () => T, readIndex: () => number, id: number) => JSX.Element): JSX.Element;\n'],
		['narrow body value', 'export declare function render<T>(readSnapshot: () => Array<{ id: string; index: number; value: T }>, renderGroup: (readValue: () => T & { marker: string }, readIndex: () => number, id: string) => JSX.Element): JSX.Element;\n'],
		['narrow body index', 'export declare function render<T>(readSnapshot: () => Array<{ id: string; index: number; value: T }>, renderGroup: (readValue: () => T, readIndex: () => 0, id: string) => JSX.Element): JSX.Element;\n'],
		['narrow body id', 'export declare function render<T>(readSnapshot: () => Array<{ id: string; index: number; value: T }>, renderGroup: (readValue: () => T, readIndex: () => number, id: "s:virune-probe" | "s:virune-generic-probe") => JSX.Element): JSX.Element;\n'],
		['narrow snapshot id', 'export declare function render<T>(readSnapshot: () => Array<{ id: "s:virune-probe" | "s:virune-generic-probe"; index: number; value: T }>, renderGroup: (readValue: () => T, readIndex: () => number, id: string) => JSX.Element): JSX.Element;\n'],
		['narrow snapshot index', 'export declare function render<T>(readSnapshot: () => Array<{ id: string; index: 0; value: T }>, renderGroup: (readValue: () => T, readIndex: () => number, id: string) => JSX.Element): JSX.Element;\n'],
		['monomorphic value', 'export declare function render(readSnapshot: () => Array<{ id: string; index: number; value: { marker: string } }>, renderGroup: (readValue: () => { marker: string }, readIndex: () => number, id: string) => JSX.Element): JSX.Element;\n'],
		['constrained generic value', 'export declare function render<T extends { marker: string }>(readSnapshot: () => Array<{ id: string; index: number; value: T }>, renderGroup: (readValue: () => T, readIndex: () => number, id: string) => JSX.Element): JSX.Element;\n'],
		['unresolved declaration', 'export declare const render: MissingHostType;\n'],
	];
	for (const [name, declarations] of cases) {
		const result = await runWithHost(declarations);
		assert.ok(result.errors.some(item => item.code === 'L2136'), name);
		assert.equal(result.emitted, false, name);
	}
});

test('Repetition Host whole-usage validation rejects any and unknown signature evidence', async () => {
	const cases: Array<[string, string]> = [
		['host any', 'export declare const render: any;\n'],
		['host unknown', 'export declare const render: unknown;\n'],
		['callback accessors any', 'export declare function render(readSnapshot: any, renderGroup: (readValue: any, readIndex: any, id: any) => any): any;\n'],
		['snapshot result any', 'export declare function render(readSnapshot: () => any, renderGroup: (readValue: () => { marker: string }, readIndex: () => number, id: string) => JSX.Element): JSX.Element;\n'],
		['snapshot id any', 'export declare function render<T>(readSnapshot: () => Array<{ id: any; index: number; value: T }>, renderGroup: (readValue: () => T, readIndex: () => number, id: string) => JSX.Element): JSX.Element;\n'],
		['snapshot index unknown', 'export declare function render<T>(readSnapshot: () => Array<{ id: string; index: unknown; value: T }>, renderGroup: (readValue: () => T, readIndex: () => number, id: string) => JSX.Element): JSX.Element;\n'],
		['body read value any', 'export declare function render(readSnapshot: () => Array<{ id: string; index: number; value: { marker: string } }>, renderGroup: (readValue: () => any, readIndex: () => number, id: string) => JSX.Element): JSX.Element;\n'],
		['body index any', 'export declare function render<T>(readSnapshot: () => Array<{ id: string; index: number; value: T }>, renderGroup: (readValue: () => T, readIndex: () => any, id: string) => JSX.Element): JSX.Element;\n'],
		['body id any', 'export declare function render<T>(readSnapshot: () => Array<{ id: string; index: number; value: T }>, renderGroup: (readValue: () => T, readIndex: () => number, id: any) => JSX.Element): JSX.Element;\n'],
		['result any', 'export declare function render<T>(readSnapshot: () => Array<{ id: string; index: number; value: T }>, renderGroup: (readValue: () => T, readIndex: () => number, id: string) => JSX.Element): any;\n'],
	];
	for (const [name, declarations] of cases) {
		const result = await runWithHost(declarations);
		assert.ok(result.errors.some(item => item.code === 'L2136'), name);
		assert.equal(result.emitted, false, name);
	}
});
