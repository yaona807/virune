import assert from 'node:assert/strict';
import test from 'node:test';
import { compileSource } from '../src/compiler.js';

// @virune-rule {"id":"ffi.safe","runner":"unit","file":"packages/compiler/test/ffi-safe-descriptor-keys.test.ts","case":"Safe record descriptor maps preserve __proto__ as an own data-property key","kind":"positive","platform":"common"}
test('Safe record descriptor maps preserve __proto__ as an own data-property key', () => {
	const result = compileSource({
		id: 1,
		path: 'ffi-safe-record-descriptor-keys.virune',
		text: `pub record ProtoPayload {
	__proto__: String
}

@jsExport
pub fn echo(value: ProtoPayload) -> ProtoPayload {
	return value
}
`,
	});
	assert.deepEqual(result.diagnostics.filter(item => item.severity === 'error'), []);
	const code = result.output?.code ?? '';
	assert.match(code, /fields: \{ \["__proto__"\]: \{ kind: 'string' \} \}/u);
	assert.doesNotMatch(code, /fields: \{ "__proto__":/u);
});

// @virune-rule {"id":"ffi.safe","runner":"unit","file":"packages/compiler/test/ffi-safe-descriptor-keys.test.ts","case":"Safe enum descriptor maps preserve __proto__ as an own data-property key","kind":"positive","platform":"common"}
test('Safe enum descriptor maps preserve __proto__ as an own data-property key', () => {
	const result = compileSource({
		id: 1,
		path: 'ffi-safe-enum-descriptor-keys.virune',
		text: `pub enum ProtoVariant {
	__proto__
}

@jsExport
pub fn echo(value: ProtoVariant) -> ProtoVariant {
	return value
}
`,
	});
	assert.deepEqual(result.diagnostics.filter(item => item.severity === 'error'), []);
	const code = result.output?.code ?? '';
	assert.match(code, /variants: \{ \["__proto__"\]: \[\] \}/u);
	assert.doesNotMatch(code, /variants: \{ "__proto__":/u);
});

// @virune-rule {"id":"ffi.safe","runner":"unit","file":"packages/compiler/test/ffi-safe-descriptor-keys.test.ts","case":"Safe record descriptors escape script-breaking JSON field names","kind":"positive","platform":"common"}
test('Safe record descriptors escape script-breaking JSON field names', () => {
	const result = compileSource({
		id: 1,
		path: 'ffi-safe-record-descriptor-script-break.virune',
		text: `pub record ScriptPayload derives Json {
	@jsonName("</script>")
	value: String
}

@jsExport
pub fn echo(value: ScriptPayload) -> ScriptPayload {
	return value
}
`,
	});
	assert.deepEqual(result.diagnostics.filter(item => item.severity === 'error'), []);
	const code = result.output?.code ?? '';
	assert.match(code, /jsonName: "\\u003C\\u002Fscript\\u003E"/u);
	assert.doesNotMatch(code, /<\/script>/u);
});

// @virune-rule {"id":"ffi.safe","runner":"unit","file":"packages/compiler/test/ffi-safe-descriptor-keys.test.ts","case":"Safe record descriptors escape script-breaking JSON defaults","kind":"positive","platform":"common"}
test('Safe record descriptors escape script-breaking JSON defaults', () => {
	const result = compileSource({
		id: 1,
		path: 'ffi-safe-record-default-script-break.virune',
		text: `pub record DefaultPayload derives Json {
	@jsonDefault("</script>")
	value: String
}

@jsExport
pub fn echo(value: DefaultPayload) -> DefaultPayload {
	return value
}
`,
	});
	assert.deepEqual(result.diagnostics.filter(item => item.severity === 'error'), []);
	const code = result.output?.code ?? '';
	assert.match(code, /defaultValue: "\\u003C\\u002Fscript\\u003E"/u);
	assert.doesNotMatch(code, /<\/script>/u);
});
