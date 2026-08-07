import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyStaticRuntimeBinding } from '../src/runtime-binding.js';

test('verifies direct ESM named declaration exports', () => {
	assert.equal(verifyStaticRuntimeBinding({ runtimeFormat: 'esm', kind: 'named', importedName: 'greet', sourceText: 'export function greet() {}' }).status, 'verified-static');
});

test('verifies local ESM export lists but not reexports or export-star', () => {
	assert.equal(verifyStaticRuntimeBinding({ runtimeFormat: 'esm', kind: 'named', importedName: 'greet', sourceText: 'const x=1; export { x as greet };' }).status, 'verified-static');
	assert.equal(verifyStaticRuntimeBinding({ runtimeFormat: 'esm', kind: 'named', importedName: 'greet', sourceText: 'export { greet } from "./other.js";' }).status, 'unknown');
	assert.equal(verifyStaticRuntimeBinding({ runtimeFormat: 'esm', kind: 'named', importedName: 'greet', sourceText: 'export * from "./other.js";' }).status, 'unknown');
	assert.equal(verifyStaticRuntimeBinding({ runtimeFormat: 'esm', kind: 'named', importedName: 'ns', sourceText: 'export * as ns from "./other.js";' }).status, 'unknown');
});

test('verifies ESM default declarations and assignments', () => {
	assert.equal(verifyStaticRuntimeBinding({ runtimeFormat: 'esm', kind: 'default', sourceText: 'export default function greet() {}' }).status, 'verified-static');
	assert.equal(verifyStaticRuntimeBinding({ runtimeFormat: 'esm', kind: 'default', sourceText: 'const greet=()=>{}; export default greet;' }).status, 'verified-static');
});

test('parse errors never produce static proof', () => {
	assert.equal(verifyStaticRuntimeBinding({ runtimeFormat: 'esm', kind: 'named', importedName: 'x', sourceText: 'export {' }).status, 'unknown');
});

test('verifies simple CommonJS named assignments', () => {
	assert.equal(verifyStaticRuntimeBinding({ runtimeFormat: 'commonjs', kind: 'named', importedName: 'greet', sourceText: 'exports.greet = () => 1;' }).status, 'verified-static');
	assert.equal(verifyStaticRuntimeBinding({ runtimeFormat: 'commonjs', kind: 'named', importedName: 'greet', sourceText: 'module.exports["greet"] = () => 1;' }).status, 'verified-static');
});

test('later module.exports replacement invalidates earlier named assignments', () => {
	assert.equal(verifyStaticRuntimeBinding({ runtimeFormat: 'commonjs', kind: 'named', importedName: 'greet', sourceText: 'exports.greet = () => 1; module.exports = { other: 1 };' }).status, 'absent');
	assert.equal(verifyStaticRuntimeBinding({ runtimeFormat: 'commonjs', kind: 'named', importedName: 'greet', sourceText: 'module.exports.greet = () => 1; module.exports = makeApi();' }).status, 'unknown');
});

test('exports alias stops proving bindings after module.exports replacement', () => {
	assert.equal(verifyStaticRuntimeBinding({ runtimeFormat: 'commonjs', kind: 'named', importedName: 'greet', sourceText: 'module.exports = {}; exports.greet = () => 1;' }).status, 'absent');
	assert.equal(verifyStaticRuntimeBinding({ runtimeFormat: 'commonjs', kind: 'named', importedName: 'greet', sourceText: 'exports = {}; exports.greet = () => 1;' }).status, 'absent');
});

test('verifies simple CommonJS object exports and known missing keys', () => {
	assert.equal(verifyStaticRuntimeBinding({ runtimeFormat: 'commonjs', kind: 'named', importedName: 'greet', sourceText: 'module.exports = { greet() {}, version: "1" };' }).status, 'verified-static');
	assert.equal(verifyStaticRuntimeBinding({ runtimeFormat: 'commonjs', kind: 'named', importedName: 'missing', sourceText: 'module.exports = { greet() {} };' }).status, 'absent');
});

test('dynamic and conditional CommonJS mutations remain unknown', () => {
	assert.equal(verifyStaticRuntimeBinding({ runtimeFormat: 'commonjs', kind: 'named', importedName: 'greet', sourceText: 'module.exports = makeApi();' }).status, 'unknown');
	assert.equal(verifyStaticRuntimeBinding({ runtimeFormat: 'commonjs', kind: 'named', importedName: 'greet', sourceText: 'if (flag) exports.greet = () => 1;' }).status, 'unknown');
	assert.equal(verifyStaticRuntimeBinding({ runtimeFormat: 'commonjs', kind: 'named', importedName: 'greet', sourceText: 'Object.defineProperty(exports, "greet", { value: 1 });' }).status, 'unknown');
	assert.equal(verifyStaticRuntimeBinding({ runtimeFormat: 'commonjs', kind: 'named', importedName: 'greet', sourceText: 'eval("exports.greet = 1")' }).status, 'unknown');
});

test('builtin named bindings are not guessed', () => {
	assert.equal(verifyStaticRuntimeBinding({ runtimeFormat: 'builtin', kind: 'named', importedName: 'definitelyNotKnownHere' }).status, 'unknown');
	assert.equal(verifyStaticRuntimeBinding({ runtimeFormat: 'builtin', kind: 'namespace' }).status, 'verified-static');
});

test('side-effect and namespace only require a statically resolved module entry', () => {
	assert.equal(verifyStaticRuntimeBinding({ runtimeFormat: 'esm', kind: 'side-effect', sourcePath: '/x/index.js' }).status, 'verified-static');
	assert.equal(verifyStaticRuntimeBinding({ runtimeFormat: 'commonjs', kind: 'namespace', sourcePath: '/x/index.cjs' }).status, 'verified-static');
});

test('type-only imports are never runtime bindings', () => {
	assert.equal(verifyStaticRuntimeBinding({ runtimeFormat: 'esm', kind: 'type-only', sourceText: 'export const x = 1;' }).status, 'not-applicable');
});

test('unsupported formats and unavailable source stay unknown', () => {
	assert.equal(verifyStaticRuntimeBinding({ runtimeFormat: 'bundler', kind: 'named', importedName: 'x', sourceText: 'export const x=1;' }).status, 'unknown');
	assert.equal(verifyStaticRuntimeBinding({ runtimeFormat: 'esm', kind: 'named', importedName: 'x' }).status, 'unknown');
});
