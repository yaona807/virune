import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { ProjectBuildResult } from '@virune/compiler/experimental';
import { CachedTypeScriptInteropProvider } from '@virune/js-interop/cached-provider';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { ProjectManager } from '../src/analysis/project-manager.js';
import { filePathToUri } from '../src/analysis/position.js';
import { findViruneEntries } from '../src/analysis/workspace-discovery.js';

const emptyBuildResult = { modules: [], diagnostics: [], stats: {} } as unknown as ProjectBuildResult;

async function waitFor(predicate: () => boolean): Promise<void> {
	for (let attempt = 0; attempt < 100; attempt++) {
		if (predicate()) return;
		await new Promise<void>(resolve => setTimeout(resolve, 5));
	}
	assert.fail('Timed out waiting for condition');
}

async function createProject(parent: string, name: string): Promise<{ root: string; path: string; document: TextDocument }> {
	const root = join(parent, name);
	const source = join(root, 'src');
	await mkdir(source, { recursive: true });
	const path = join(source, 'main.virune');
	const text = 'fn main() -> Int => 1\n';
	await writeFile(join(root, 'virune.json'), JSON.stringify({ sourceDir: 'src' }));
	await writeFile(path, text);
	return { root, path, document: TextDocument.create(filePathToUri(path), 'virune', 1, text) };
}

test('workspace discovery scans configured source roots and excludes generated directories', async t => {
	const root = await mkdtemp(join(tmpdir(), 'virune-lsp-discovery-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	await mkdir(join(root, 'src', 'generated'), { recursive: true });
	await mkdir(join(root, 'tests'), { recursive: true });
	await mkdir(join(root, 'docs'), { recursive: true });
	await writeFile(join(root, 'virune.json'), JSON.stringify({
		sourceDir: 'src',
		testSourceDirs: ['tests'],
		exclude: ['src/generated'],
	}));
	const mainPath = join(root, 'src', 'main.virune');
	const testPath = join(root, 'tests', 'main.test.virune');
	await writeFile(mainPath, 'fn main() -> Int => 1\n');
	await writeFile(testPath, 'test "main" { expect(true) }\n');
	await writeFile(join(root, 'src', 'generated', 'large.virune'), 'fn generated() -> Int => 1\n');
	await writeFile(join(root, 'docs', 'sample.virune'), 'fn sample() -> Int => 1\n');

	assert.deepEqual(await findViruneEntries(root), [mainPath, testPath].sort((left, right) => left.localeCompare(right)));
});

test('invalidating one project preserves cached analysis for other roots', async t => {
	const parent = await mkdtemp(join(tmpdir(), 'virune-lsp-project-invalidation-'));
	t.after(() => rm(parent, { recursive: true, force: true }));
	const first = await createProject(parent, 'first');
	const second = await createProject(parent, 'second');
	const counts = new Map<string, number>();
	const manager = new ProjectManager({
		getOpenDocuments: () => [first.document, second.document],
		workspaceFolders: [first.root, second.root],
		createBuilder: () => ({
			build: async (root: string) => {
				counts.set(root, (counts.get(root) ?? 0) + 1);
				return emptyBuildResult;
			},
		}),
	});
	await manager.analyzeWorkspaceDocument(first.document.uri);
	await manager.analyzeWorkspaceDocument(second.document.uri);
	assert.equal(counts.get(first.root), 1);
	assert.equal(counts.get(second.root), 1);

	manager.invalidateProject(first.root);
	await manager.analyzeWorkspaceDocument(first.document.uri);
	await manager.analyzeWorkspaceDocument(second.document.uri);
	assert.equal(counts.get(first.root), 2);
	assert.equal(counts.get(second.root), 1);
});

test('project invalidation does not discard another root build completing concurrently', async t => {
	const parent = await mkdtemp(join(tmpdir(), 'virune-lsp-project-revision-'));
	t.after(() => rm(parent, { recursive: true, force: true }));
	const first = await createProject(parent, 'first');
	const second = await createProject(parent, 'second');
	let secondBuilds = 0;
	let secondStarted = false;
	let releaseSecond!: () => void;
	const secondGate = new Promise<void>(resolve => { releaseSecond = resolve; });
	const manager = new ProjectManager({
		getOpenDocuments: () => [first.document, second.document],
		workspaceFolders: [first.root, second.root],
		createBuilder: () => ({
			build: async (root: string) => {
				if (root === second.root) {
					secondBuilds++;
					secondStarted = true;
					await secondGate;
				}
				return emptyBuildResult;
			},
		}),
	});
	await manager.analyzeWorkspaceDocument(first.document.uri);
	const secondRequest = manager.analyzeWorkspaceDocument(second.document.uri);
	await waitFor(() => secondStarted);
	manager.invalidateProject(first.root);
	releaseSecond();
	assert.ok(await secondRequest);
	assert.ok(await manager.analyzeWorkspaceDocument(second.document.uri));
	assert.equal(secondBuilds, 1);
});

test('interop invalidation rotates only the affected project generation', async t => {
	const parent = await mkdtemp(join(tmpdir(), 'virune-lsp-interop-generation-'));
	t.after(() => rm(parent, { recursive: true, force: true }));
	const first = await createProject(parent, 'first');
	const second = await createProject(parent, 'second');
	const created = new Map<string, number[]>();
	const disposed: string[] = [];
	const manager = new ProjectManager({
		getOpenDocuments: () => [first.document, second.document],
		workspaceFolders: [first.root, second.root],
		createBuilder: () => ({ build: async () => emptyBuildResult }),
		createInteropProvider: (root, generation) => {
			const values = created.get(root) ?? [];
			values.push(generation);
			created.set(root, values);
			return {
				generation,
				dispose: () => disposed.push(root),
			} as unknown as CachedTypeScriptInteropProvider;
		},
	});
	await manager.analyzeWorkspaceDocument(first.document.uri);
	await manager.analyzeWorkspaceDocument(second.document.uri);
	assert.deepEqual(created.get(first.root), [1]);
	assert.deepEqual(created.get(second.root), [1]);

	manager.invalidateProject(first.root, { interop: true });
	assert.deepEqual(disposed, [first.root]);
	assert.equal(manager.interopGeneration(first.root), 2);
	assert.equal(manager.interopGeneration(second.root), 1);
	await manager.analyzeWorkspaceDocument(first.document.uri);
	await manager.analyzeWorkspaceDocument(second.document.uri);
	assert.deepEqual(created.get(first.root), [1, 2]);
	assert.deepEqual(created.get(second.root), [1]);
});

test('ten open documents share one workspace build for project diagnostics', async t => {
	const root = await mkdtemp(join(tmpdir(), 'virune-lsp-root-diagnostics-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	const source = join(root, 'src');
	await mkdir(source);
	await writeFile(join(root, 'virune.json'), JSON.stringify({ sourceDir: 'src' }));
	const documents: TextDocument[] = [];
	for (let index = 0; index < 10; index++) {
		const path = join(source, `module-${index}.virune`);
		const text = `fn value${index}() -> Int => ${index}\n`;
		await writeFile(path, text);
		documents.push(TextDocument.create(filePathToUri(path), 'virune', 1, text));
	}
	let builds = 0;
	const manager = new ProjectManager({
		getOpenDocuments: () => documents,
		workspaceFolders: [root],
		createBuilder: () => ({
			build: async () => {
				builds++;
				return emptyBuildResult;
			},
		}),
	});
	await Promise.all(documents.map(document => manager.analyzeWorkspaceDocument(document.uri)));
	assert.equal(builds, 1);
});
