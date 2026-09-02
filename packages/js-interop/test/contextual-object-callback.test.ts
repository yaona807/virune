import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import { buildProject } from '@virune/compiler/experimental';
import { TypeScriptInteropProvider } from '../src/index.js';

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const temporaryRoot = join(repositoryRoot, '.test-tmp');

async function runCase(declarations: string, suffix: string): Promise<void> {
	await mkdir(temporaryRoot, { recursive: true });
	const root = await mkdtemp(join(temporaryRoot, 'virune-interop-contextual-object-callback-'));
	await mkdir(join(root, 'src'), { recursive: true });
	await writeFile(join(root, 'virune.json'), JSON.stringify({
		languageVersion: '1.0',
		platform: 'node',
		sourceDir: 'src',
		outDir: 'dist',
		entry: 'src/main.virune',
		target: 'es2022',
		sourceMap: false,
		sourcesContent: false,
	}), 'utf8');
	await writeFile(join(root, 'src/library.js'), `
let retained;
const target = {
	state: '',
	mark(value) {
		this.state = value;
		return this;
	},
};
export function consume(config) { retained = config.onEvent; }
export function trigger() {
	if (retained) retained({ currentTarget: target });
	return target.state;
}
`, 'utf8');
	await writeFile(join(root, 'src/library.d.ts'), declarations, 'utf8');
	await writeFile(join(root, 'src/main.virune'), `import js { consume, trigger } from "./library.js"

@jsExport
pub fn run() -> String uses JavaScript {
	discard consume({
		onEvent: fn(event) uses JavaScript => event.currentTarget.mark("seen"),
	})
	return trigger()
}
`, 'utf8');

	const provider = new TypeScriptInteropProvider({ projectRoot: root });
	const result = await buildProject(root, { write: true, jsInteropProvider: provider });
	assert.deepEqual(result.diagnostics.filter(item => item.severity === 'error'), []);
	const mainModule = result.modules.find(item => item.source.path.endsWith('main.virune'));
	assert.ok(mainModule?.semantic);
	assert.equal(mainModule.semantic.interop.objectCallableProjections?.length, 1);
	const projection = mainModule.semantic.interop.objectCallableProjections?.[0];
	assert.ok(projection);
	assert.equal(projection.descriptor.version, 'virune-callable-shim/v2');
	assert.deepEqual(projection.descriptor.parameters, ['External']);
	assert.equal(projection.descriptor.result, 'External');
	assert.equal(projection.descriptor.async, false);
	const generated = await readFile(join(root, 'dist/main.js'), 'utf8');
	assert.match(generated, /\$viruneProjectCallable\(/u);
	assert.match(generated, /\$fn\(\$raw0, rootTaskContext\(\)\)/u);
	await writeFile(join(root, 'dist/library.js'), await readFile(join(root, 'src/library.js'), 'utf8'), 'utf8');
	const module = await import(`${pathToFileURL(join(root, 'dist/main.js')).href}?contextual-object-callback-${suffix}`) as { run(): string };
	assert.equal(module.run(), 'seen');
}

const commonDeclarations = `
export interface ExternalTarget {
	mark(value: string): ExternalTarget;
}
export interface ExternalEvent {
	readonly currentTarget: ExternalTarget;
}
export declare function trigger(): string;
`;

test('unannotated synchronous callback in optional contextual External object property is projected', async () => {
	await runCase(`${commonDeclarations}
export declare function consume(config: { onEvent?: (event: ExternalEvent) => ExternalTarget }): void;
`, 'optional');
});

test('contextual object callback aliases retain TypeScript callable evidence', async () => {
	await runCase(`${commonDeclarations}
type EventHandler<E> = { bivarianceHack(event: E): ExternalTarget }['bivarianceHack'];
export declare function consume(config: { onEvent?: EventHandler<ExternalEvent> }): void;
`, 'bivariance');
});
