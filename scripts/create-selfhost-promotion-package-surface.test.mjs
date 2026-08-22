import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { hashPackageProductSurface } from './create-selfhost-promotion-subject.mjs';

const unsupportedExecutionMetadata = Object.freeze({
	browser: './dist/src/index.js',
	cpu: ['x64'],
	imports: { '#runtime': './dist/src/index.js' },
	libc: ['glibc'],
	main: './dist/src/index.js',
	module: './dist/src/index.js',
	optionalDependencies: { dependency: '1.0.0' },
	os: ['linux'],
	peerDependencies: { dependency: '1.0.0' },
	peerDependenciesMeta: { dependency: { optional: true } },
	sideEffects: false,
});

async function fixture() {
	const root = await mkdtemp(join(tmpdir(), 'virune-promotion-package-surface-'));
	await mkdir(join(root, 'dist', 'src'), { recursive: true });
	await writeFile(join(root, 'dist', 'src', 'index.js'), 'export const value = 1;\n', 'utf8');
	return {
		root,
		cleanup: () => rm(root, { recursive: true, force: true }),
	};
}

function baseManifest() {
	return {
		name: '@virune/fixture',
		version: '1.0.0',
		type: 'module',
		engines: { node: '>=24.0.0' },
		exports: { '.': './dist/src/index.js' },
		dependencies: {},
		description: 'metadata only',
	};
}

test('package product surface fails closed on unmodeled execution-relevant package metadata', async () => {
	for (const [field, value] of Object.entries(unsupportedExecutionMetadata)) {
		const f = await fixture();
		try {
			await writeFile(join(f.root, 'package.json'), JSON.stringify({ ...baseManifest(), [field]: value }), 'utf8');
			await assert.rejects(
				() => hashPackageProductSurface({ packageRoot: f.root, claim: 'fixture-product-v1' }),
				new RegExp(`unsupported execution-relevant metadata: .*${field}`, 'u'),
			);
		} finally {
			await f.cleanup();
		}
	}
});

test('package product surface continues to ignore documentation-only package metadata', async () => {
	const f = await fixture();
	try {
		await writeFile(join(f.root, 'package.json'), JSON.stringify(baseManifest()), 'utf8');
		const baseline = await hashPackageProductSurface({ packageRoot: f.root, claim: 'fixture-product-v1' });
		await writeFile(join(f.root, 'package.json'), JSON.stringify({
			...baseManifest(),
			description: 'changed metadata only',
			keywords: ['documentation', 'metadata'],
		}), 'utf8');
		assert.equal((await hashPackageProductSurface({ packageRoot: f.root, claim: 'fixture-product-v1' })).sha256, baseline.sha256);
	} finally {
		await f.cleanup();
	}
});
