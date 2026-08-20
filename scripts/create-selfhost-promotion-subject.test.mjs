import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { hashArtifactTree, hashFixedModuleSet, hashPackageProductSurface, hashRelativeModuleClosure } from './create-selfhost-promotion-subject.mjs';

function digest(value) {
	return createHash('sha256').update(value).digest('hex');
}

async function fixture() {
	const root = await mkdtemp(join(tmpdir(), 'virune-promotion-subject-'));
	return { root, async cleanup() { await rm(root, { recursive: true, force: true }); } };
}

test('artifact tree identity is deterministic and changes with product bytes, not directory enumeration order', async () => {
	const f = await fixture();
	try {
		await mkdir(join(f.root, 'nested'), { recursive: true });
		await writeFile(join(f.root, 'z.js'), 'z', 'utf8');
		await writeFile(join(f.root, 'nested', 'a.js'), 'a', 'utf8');
		const first = await hashArtifactTree(f.root, 'fixture-v1');
		const second = await hashArtifactTree(f.root, 'fixture-v1');
		assert.equal(first.sha256, second.sha256);
		assert.deepEqual(first.manifest.files.map(item => item.path), ['nested/a.js', 'z.js']);
		await writeFile(join(f.root, 'nested', 'a.js'), 'changed', 'utf8');
		assert.notEqual((await hashArtifactTree(f.root, 'fixture-v1')).sha256, first.sha256);
	} finally { await f.cleanup(); }
});

test('package product surface binds executable exports, engines, dependencies, and built artifact without metadata noise', async () => {
	const f = await fixture();
	try {
		await mkdir(join(f.root, 'dist', 'src'), { recursive: true });
		await writeFile(join(f.root, 'dist', 'src', 'index.js'), 'export const value = 1;\n', 'utf8');
		const packageManifest = {
			name: '@virune/fixture',
			version: '1.0.0',
			type: 'module',
			engines: { node: '>=24.0.0' },
			exports: { '.': './dist/src/index.js' },
			dependencies: { '@virune/runtime': '1.0.0' },
			description: 'metadata only',
			keywords: ['ignored'],
		};
		await writeFile(join(f.root, 'package.json'), JSON.stringify(packageManifest), 'utf8');
		const first = await hashPackageProductSurface({ packageRoot: f.root, claim: 'fixture-product-v1' });
		await writeFile(join(f.root, 'package.json'), JSON.stringify({ ...packageManifest, description: 'changed metadata', keywords: ['also ignored'] }), 'utf8');
		assert.equal((await hashPackageProductSurface({ packageRoot: f.root, claim: 'fixture-product-v1' })).sha256, first.sha256);
		await writeFile(join(f.root, 'package.json'), JSON.stringify({ ...packageManifest, exports: { '.': './dist/src/other.js' } }), 'utf8');
		assert.notEqual((await hashPackageProductSurface({ packageRoot: f.root, claim: 'fixture-product-v1' })).sha256, first.sha256);
		await writeFile(join(f.root, 'package.json'), JSON.stringify({ ...packageManifest, dependencies: { '@virune/runtime': '2.0.0' } }), 'utf8');
		assert.notEqual((await hashPackageProductSurface({ packageRoot: f.root, claim: 'fixture-product-v1' })).sha256, first.sha256);
		await writeFile(join(f.root, 'package.json'), JSON.stringify(packageManifest), 'utf8');
		await writeFile(join(f.root, 'dist', 'src', 'index.js'), 'export const value = 2;\n', 'utf8');
		assert.notEqual((await hashPackageProductSurface({ packageRoot: f.root, claim: 'fixture-product-v1' })).sha256, first.sha256);
	} finally { await f.cleanup(); }
});

test('fixed Host contract hashes exactly the versioned boundary file set', async () => {
	const f = await fixture();
	try {
		await mkdir(join(f.root, 'selfhost'), { recursive: true });
		await writeFile(join(f.root, 'selfhost', 'selection.js'), "import './legacy-implementation.js';\nexport const selection = 'legacy';\n", 'utf8');
		await writeFile(join(f.root, 'selfhost', 'stage-loader.js'), "export const load = 'stage';\n", 'utf8');
		await writeFile(join(f.root, 'selfhost', 'legacy-implementation.js'), "export const implementation = 1;\n", 'utf8');
		const files = ['selfhost/stage-loader.js', 'selfhost/selection.js'];
		const first = await hashFixedModuleSet({ baseDirectory: f.root, files, claim: 'fixture-host-v1' });
		assert.deepEqual(first.manifest.files.map(item => item.path), ['selfhost/selection.js', 'selfhost/stage-loader.js']);
		await writeFile(join(f.root, 'selfhost', 'legacy-implementation.js'), "export const implementation = 2;\n", 'utf8');
		assert.equal((await hashFixedModuleSet({ baseDirectory: f.root, files, claim: 'fixture-host-v1' })).sha256, first.sha256);
		await writeFile(join(f.root, 'selfhost', 'stage-loader.js'), "export const load = 'changed';\n", 'utf8');
		assert.notEqual((await hashFixedModuleSet({ baseDirectory: f.root, files, claim: 'fixture-host-v1' })).sha256, first.sha256);
	} finally { await f.cleanup(); }
});

test('fixed Host contract fails closed on duplicate, missing, or symlink boundary entries', async () => {
	const f = await fixture();
	try {
		await mkdir(join(f.root, 'selfhost'), { recursive: true });
		await writeFile(join(f.root, 'selfhost', 'real.js'), 'export const x = 1;\n', 'utf8');
		await assert.rejects(
			() => hashFixedModuleSet({ baseDirectory: f.root, files: ['selfhost/real.js', 'selfhost/real.js'], claim: 'fixture-host-v1' }),
			/duplicate module paths/u,
		);
		await assert.rejects(
			() => hashFixedModuleSet({ baseDirectory: f.root, files: ['selfhost/missing.js'], claim: 'fixture-host-v1' }),
			/ENOENT/u,
		);
		await symlink(join(f.root, 'selfhost', 'real.js'), join(f.root, 'selfhost', 'link.js'));
		await assert.rejects(
			() => hashFixedModuleSet({ baseDirectory: f.root, files: ['selfhost/link.js'], claim: 'fixture-host-v1' }),
			/non-symlink/u,
		);
	} finally { await f.cleanup(); }
});

test('bootstrap policy closure follows from, dynamic, re-export, and side-effect relative imports transitively', async () => {
	const f = await fixture();
	try {
		await mkdir(join(f.root, 'selfhost'), { recursive: true });
		await writeFile(join(f.root, 'selfhost', 'root.js'), [
			"import './side.js';",
			"import { value } from './from.js';",
			"export { other } from './exported.js';",
			"export async function load() { return import('./dynamic.js'); }",
			'export { value };',
		].join('\n'), 'utf8');
		await writeFile(join(f.root, 'selfhost', 'side.js'), "import './deep.js';\n", 'utf8');
		for (const name of ['from.js', 'exported.js', 'dynamic.js', 'deep.js']) await writeFile(join(f.root, 'selfhost', name), `export const x = '${name}';\n`, 'utf8');
		const result = await hashRelativeModuleClosure({ baseDirectory: f.root, roots: ['selfhost/root.js'], claim: 'fixture-bootstrap-policy-v1' });
		assert.deepEqual(result.manifest.files.map(item => item.path), [
			'selfhost/deep.js', 'selfhost/dynamic.js', 'selfhost/exported.js', 'selfhost/from.js', 'selfhost/root.js', 'selfhost/side.js',
		]);
	} finally { await f.cleanup(); }
});

test('module closure rejects imports that escape the configured artifact root', async () => {
	const f = await fixture();
	try {
		await mkdir(join(f.root, 'base'), { recursive: true });
		await writeFile(join(f.root, 'base', 'root.js'), "export { x } from '../outside.js';\n", 'utf8');
		await writeFile(join(f.root, 'outside.js'), 'export const x = 1;\n', 'utf8');
		await assert.rejects(
			() => hashRelativeModuleClosure({ baseDirectory: join(f.root, 'base'), roots: ['root.js'], claim: 'fixture-policy-v1' }),
			/path escaped product closure root|must stay inside/u,
		);
	} finally { await f.cleanup(); }
});

test('canonical digest helper expectation documents raw artifact hash semantics', () => {
	assert.equal(digest(Buffer.from('abc')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});
