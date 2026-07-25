import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { verifyTypeScriptBoundary } from './verify-typescript-boundary.mjs';

async function fixture(run) {
	const root = await mkdtemp(resolve(tmpdir(), 'virune-typescript-boundary-'));
	try {
		await mkdir(resolve(root, '.github'), { recursive: true });
		await mkdir(resolve(root, 'packages/js-interop/src'), { recursive: true });
		await writeFile(resolve(root, '.github/typescript-version-policy.json'), JSON.stringify({
			current: { buildCompiler: '6.0.3', compilerApi: '6.0.3' },
			compilerApiBoundary: {
				allowedSourceRoots: ['packages/js-interop/'],
				allowedPackageManifests: ['package.json', 'packages/js-interop/package.json'],
			},
		}));
		await writeFile(resolve(root, 'package.json'), JSON.stringify({ devDependencies: { typescript: '6.0.3' } }));
		await writeFile(resolve(root, 'packages/js-interop/package.json'), JSON.stringify({ dependencies: { typescript: '6.0.3' } }));
		await writeFile(resolve(root, 'packages/js-interop/src/index.ts'), "import ts from 'typescript';\nexport const version = ts.version;\n");
		await run(root);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

test('accepts TypeScript API imports inside the interop boundary', () => fixture(async root => {
	const report = await verifyTypeScriptBoundary({ root, policyFile: resolve(root, '.github/typescript-version-policy.json') });
	assert.equal(report.passed, true);
	assert.deepEqual(report.imports.map(item => item.path), ['packages/js-interop/src/index.ts']);
}));

test('rejects TypeScript API imports outside the interop boundary', () => fixture(async root => {
	await mkdir(resolve(root, 'packages/compiler/src'), { recursive: true });
	await writeFile(resolve(root, 'packages/compiler/src/forbidden.ts'), "import ts from 'typescript';\nexport const version = ts.version;\n");
	await assert.rejects(
		verifyTypeScriptBoundary({ root, policyFile: resolve(root, '.github/typescript-version-policy.json') }),
		/compiler-api-import-outside-boundary/,
	);
}));

test('rejects TypeScript dependencies in unrelated workspace manifests', () => fixture(async root => {
	await mkdir(resolve(root, 'packages/compiler'), { recursive: true });
	await writeFile(resolve(root, 'packages/compiler/package.json'), JSON.stringify({ devDependencies: { typescript: '6.0.3' } }));
	await assert.rejects(
		verifyTypeScriptBoundary({ root, policyFile: resolve(root, '.github/typescript-version-policy.json') }),
		/typescript-dependency-outside-boundary/,
	);
}));
