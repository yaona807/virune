import assert from 'node:assert/strict';
import test from 'node:test';
import { validateNodeApiBaseline } from './verify-node-runtime.mjs';
import { validateVscodeApiBaseline } from './verify-vscode-api-baseline.mjs';

function packageJson(engine = '>=1.100.0', types = '1.100.0') {
	return {
		engines: { vscode: engine },
		devDependencies: { '@types/vscode': types },
	};
}

function nodePackageJson(engine = '>=24.0.0', types = '^24.0.0') {
	return {
		engines: { node: engine },
		devDependencies: { '@types/node': types },
	};
}

test('accepts matching VS Code major.minor API baselines', () => {
	assert.deepEqual(validateVscodeApiBaseline(packageJson('>=1.100.0', '1.100.2')), {
		engine: { major: 1, minor: 100, patch: 0 },
		types: { major: 1, minor: 100, patch: 2 },
	});
});

test('rejects type definitions newer than the supported runtime baseline', () => {
	assert.throws(() => validateVscodeApiBaseline(packageJson('>=1.100.0', '1.125.0')), /major\.minor versions must match/u);
});

test('rejects ranged @types/vscode declarations', () => {
	assert.throws(() => validateVscodeApiBaseline(packageJson('>=1.100.0', '^1.100.0')), /must be pinned to an exact/u);
});

test('rejects ambiguous VS Code engine ranges', () => {
	assert.throws(() => validateVscodeApiBaseline(packageJson('^1.100.0', '1.100.0')), /must use an explicit/u);
});

test('accepts matching Node.js major API baselines', () => {
	assert.deepEqual(validateNodeApiBaseline(nodePackageJson('>=24.0.0', '^24.13.3')), {
		engine: { major: 24, minor: 0, patch: 0 },
		types: { major: 24, minor: 13, patch: 3 },
	});
});

test('rejects Node.js type definitions newer than the supported runtime major', () => {
	assert.throws(() => validateNodeApiBaseline(nodePackageJson('>=24.0.0', '^26.1.1')), /major versions must match/u);
});

test('rejects ambiguous Node.js engine ranges', () => {
	assert.throws(() => validateNodeApiBaseline(nodePackageJson('^24.0.0', '^24.0.0')), /must use an explicit/u);
});

test('rejects broad @types/node ranges', () => {
	assert.throws(() => validateNodeApiBaseline(nodePackageJson('>=24.0.0', '>=24.0.0')), /must use a single/u);
});
