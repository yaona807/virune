import assert from 'node:assert/strict';
import test from 'node:test';
import { validateVscodeApiBaseline } from './verify-vscode-api-baseline.mjs';

function packageJson(engine = '>=1.100.0', types = '1.100.0') {
	return {
		engines: { vscode: engine },
		devDependencies: { '@types/vscode': types },
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
