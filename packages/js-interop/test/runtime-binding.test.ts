import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyStaticRuntimeBinding } from '../src/runtime-binding.js';

test('verifies direct ESM named declaration exports', () => {
	assert.deepEqual(verifyStaticRuntimeBinding({ runtimeFormat: 'esm', kind: 'named', importedName: 'greet', sourceText: 'export function greet() {}' }), {
		status: 'verified-static', reason: 'ESM_DECLARATION_EXPORT', exportName: 'greet',
	});
});

test('verifies local ESM export lists but not reexports', () => {
	assert.equal(verifyStaticRuntimeBinding({ runtimeFormat: 'esm', kind: 'named', importedName: 'greet', sourceText: 'const x=1; export { x as greet };' }).status, 'verified-static');
	assert.deepEqual(verifyStaticRuntimeBinding({ runtimeFormat: 'esm', kind: 'named', importedName: 'greet', sourceText: 'export { greet } from "./other.js";' }), {
		status: 'unknown', reason: 'ESM_REEXPORT_UNKNOWN', exportName: 'greet',
	});
});

test('does not turn export-star into proof', () => {
	assert.deepEqual(verifyStaticRuntimeBinding({ runtimeFormat: 'esm', kind: 'named', importedName: 'greet', sourceText: 'export * from "./other.js";' }), {
		status: 'unknown', reason: 'ESM_EXPORT_STAR_UNKNOWN', exportName: 'greet',
	});
});

test('verifies ESM default declarations and assignments', () => {
	assert.equal(verifyStaticRuntimeBinding({ runtimeFormat: 'esm', kind: 'default', sourceText: 'export default function greet() {}' }).status, 'verified-static');
	assert.equal(verifyStaticRuntimeBinding({ runtimeFormat: 'esm', kind: 'default', sourceText: 'const greet=()=>{}; export default greet;' }).status, 'verified-static');
});

test('verifies simple CommonJS named assignments', () => {
	assert.equal(verifyStaticRuntimeBinding({ runtimeFormat: 'commonjs', kind: 'named', importedName: 'greet', sourceText: 'exports.greet = () => 1;' }).status, 'verified-static');
	assert.equal(verifyStaticRuntimeBinding({ runtimeFormat: 'commonjs', kind: 'named', importedName: 'greet', sourceText: 'module.exports["greet"] = () => 1;' }).status, 'verified-static');
});

test('verifies simple CommonJS object exports and proves missing object keys absent', () => {
	assert.equal(verifyStaticRuntimeBinding({ runtimeFormat: 'commonjs', kind: 'named', importedName: 'greet', sourceText: 'module.exports = { greet() {}, version: "1" };' }).status, 'verified-static');
	assert.equal(verifyStaticRuntimeBinding({ runtimeFormat: 'commonjs', kind: 'named', importedName: 'missing', sourceText: 'module.exports = { greet() {} };' }).status, 'absent');
});

test('dynamic CommonJS module.exports remains unknown', () => {
	assert.deepEqual(verifyStaticRuntimeBinding({ runtimeFormat: 'commonjs', kind: 'named', importedName: 'greet', sourceText: 'module.exports = makeApi();' }), {
		status: 'unknown', reason: 'DYNAMIC_CJS_EXPORT', exportName: 'greet',
	});
});

test('does not confuse nested assignments with top-level export proof', () => {
	assert.equal(verifyStaticRuntimeBinding({ runtimeFormat: 'commonjs', kind: 'named', importedName: 'greet', sourceText: 'if (flag) exports.greet = () => 1;' }).status, 'absent');
});

test('side-effect and namespace only require a statically resolved module entry', () => {
	assert.equal(verifyStaticRuntimeBinding({ runtimeFormat: 'esm', kind: 'side-effect', sourcePath: '/x/index.js' }).status, 'verified-static');
	assert.equal(verifyStaticRuntimeBinding({ runtimeFormat: 'commonjs', kind: 'namespace', sourcePath: '/x/index.cjs' }).status, 'verified-static');
});

test('type-only imports are never runtime bindings', () => {
	assert.deepEqual(verifyStaticRuntimeBinding({ runtimeFormat: 'esm', kind: 'type-only', sourceText: 'export const x = 1;' }), { status: 'not-applicable', reason: 'TYPE_ONLY' });
});

test('unsupported formats and unavailable source stay unknown', () => {
	assert.equal(verifyStaticRuntimeBinding({ runtimeFormat: 'bundler', kind: 'named', importedName: 'x', sourceText: 'export const x=1;' }).status, 'unknown');
	assert.equal(verifyStaticRuntimeBinding({ runtimeFormat: 'esm', kind: 'named', importedName: 'x' }).status, 'unknown');
});
