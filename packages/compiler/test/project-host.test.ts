import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { buildProject, type ProjectHost } from '../src/project/project.js';

async function withProject(run: (root: string) => Promise<void>): Promise<void> {
	const root = await mkdtemp(join(tmpdir(), 'virune-project-host-'));
	try {
		await mkdir(join(root, 'src'), { recursive: true });
		await writeFile(join(root, 'virune.json'), JSON.stringify({
			languageVersion: '1.0',
			platform: 'node',
			sourceDir: 'src',
			outDir: 'dist',
			entry: 'src/main.virune',
			target: 'es2022',
			sourceMap: true,
			sourcesContent: true,
		}), 'utf8');
		await run(root);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

function overlayHost(entries: ReadonlyMap<string, string>): ProjectHost {
	return {
		readFile: async path => entries.get(resolve(path)) ?? readFile(path, 'utf8'),
	};
}

test('buildProject analyzes unsaved entry text supplied by a ProjectHost', async () => {
	await withProject(async root => {
		const entry = join(root, 'src/main.virune');
		await writeFile(entry, 'pub fn main() -> Unit {\n\treturn\n}\n', 'utf8');
		const host = overlayHost(new Map([[resolve(entry), 'pub fn main() -> Unit {\n\tlet value: String = 1\n}\n']]));
		const result = await buildProject(root, { write: false, host });
		assert.ok(result.diagnostics.some(diagnostic => diagnostic.severity === 'error'));
	});
});

test('buildProject analyzes unsaved imported modules supplied by a ProjectHost', async () => {
	await withProject(async root => {
		const entry = join(root, 'src/main.virune');
		const dependency = join(root, 'src/value.virune');
		await writeFile(entry, 'import { value } from "./value.virune"\n\npub fn main() -> Unit {\n\tlet result: Int = value()\n}\n', 'utf8');
		await writeFile(dependency, 'pub fn value() -> Int => 1\n', 'utf8');
		const host = overlayHost(new Map([[resolve(dependency), 'pub fn value() -> String => "one"\n']]));
		const result = await buildProject(root, { write: false, host });
		assert.ok(result.diagnostics.some(diagnostic => diagnostic.severity === 'error'));
	});
});

test('buildProject can analyze an additional standalone file without the default entry', async () => {
	const root = await mkdtemp(join(tmpdir(), 'virune-standalone-host-'));
	try {
		const entry = join(root, 'sample.virune');
		await writeFile(entry, 'fn value() -> Int => 1\n', 'utf8');
		const result = await buildProject(root, {
			write: false,
			additionalEntries: [entry],
			includeConfigEntry: false,
		});
		assert.equal(result.modules.length, 1);
		assert.equal(result.modules[0]?.source.path, resolve(entry));
		assert.equal(result.diagnostics.some(diagnostic => diagnostic.code === 'L5001'), false);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test('incremental build reuses unchanged parse, type-check, and emit results', async () => {
	await withProject(async root => {
		const entry = join(root, 'src/main.virune');
		const dependency = join(root, 'src/value.virune');
		await writeFile(entry, 'import { value } from "./value.virune"\n\npub fn main() -> Unit {\n\tlet result: Int = value()\n}\n', 'utf8');
		await writeFile(dependency, 'pub fn value() -> Int => 1\n', 'utf8');
		const { IncrementalProjectBuilder } = await import('../src/project/incremental.js');
		const builder = new IncrementalProjectBuilder();
		const initial = await builder.build(root, { write: false });
		assert.equal(initial.stats.parsedModules, 2);
		assert.equal(initial.stats.checkedModules, 2);
		const repeated = await builder.build(root, { write: false });
		assert.equal(repeated.stats.reusedParsedModules, 2);
		assert.equal(repeated.stats.reusedCheckedModules, 2);
		assert.equal(repeated.stats.reusedEmittedModules, 2);
		assert.deepEqual(repeated.modules.map(module => module.output?.code), initial.modules.map(module => module.output?.code));
	});
});

test('implementation-only changes do not re-check dependent modules', async () => {
	await withProject(async root => {
		const entry = join(root, 'src/main.virune');
		const dependency = join(root, 'src/value.virune');
		await writeFile(entry, 'import { value } from "./value.virune"\n\npub fn main() -> Unit {\n\tlet result: Int = value()\n}\n', 'utf8');
		await writeFile(dependency, 'pub fn value() -> Int => 1\n', 'utf8');
		const { IncrementalProjectBuilder } = await import('../src/project/incremental.js');
		const builder = new IncrementalProjectBuilder();
		await builder.build(root, { write: false });
		await writeFile(dependency, 'pub fn value() -> Int => 2\n', 'utf8');
		const changed = await builder.build(root, { write: false });
		assert.equal(changed.stats.parsedModules, 1);
		assert.equal(changed.stats.reusedParsedModules, 1);
		assert.equal(changed.stats.checkedModules, 1);
		assert.equal(changed.stats.reusedCheckedModules, 1);
	});
});

test('public signature changes invalidate dependent modules', async () => {
	await withProject(async root => {
		const entry = join(root, 'src/main.virune');
		const dependency = join(root, 'src/value.virune');
		await writeFile(entry, 'import { value } from "./value.virune"\n\npub fn main() -> Unit {\n\tlet result: Int = value()\n}\n', 'utf8');
		await writeFile(dependency, 'pub fn value() -> Int => 1\n', 'utf8');
		const { IncrementalProjectBuilder } = await import('../src/project/incremental.js');
		const builder = new IncrementalProjectBuilder();
		await builder.build(root, { write: false });
		await writeFile(dependency, 'pub fn value() -> String => "changed"\n', 'utf8');
		const changed = await builder.build(root, { write: false });
		assert.equal(changed.stats.checkedModules, 2);
		assert.ok(changed.diagnostics.some(diagnostic => diagnostic.severity === 'error'));
	});
});
