import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compareSnapshots } from './verify-public-abi.mjs';

const base = {
	schemaVersion: 1,
	packages: {
		'@virune/runtime': {
			packageExports: { '.': './dist/src/index.js' },
			entries: { '.': { exports: { keep: 'function keep(): void' } } },
		},
	},
	emitterRuntimeSymbols: ['keep'],
};

test('classifies added exports separately from breaking changes', () => {
	const current = structuredClone(base);
	current.packages['@virune/runtime'].entries['.'].exports.added = 'function added(): void';
	assert.deepEqual(compareSnapshots(base, current), [{ kind: 'ADDITIVE', message: '@virune/runtime. export added: added' }]);
});

test('classifies removed and changed exports as breaking', () => {
	const removed = structuredClone(base);
	delete removed.packages['@virune/runtime'].entries['.'].exports.keep;
	assert.equal(compareSnapshots(base, removed)[0].kind, 'BREAKING');
	const changed = structuredClone(base);
	changed.packages['@virune/runtime'].entries['.'].exports.keep = 'function keep(value: string): void';
	assert.equal(compareSnapshots(base, changed)[0].kind, 'BREAKING');
});
