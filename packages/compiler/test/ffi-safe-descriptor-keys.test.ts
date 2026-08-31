import assert from 'node:assert/strict';
import test from 'node:test';
import { compileSource } from '../src/compiler.js';

// @virune-rule {"id":"ffi.safe","runner":"unit","file":"packages/compiler/test/ffi-safe-descriptor-keys.test.ts","case":"Safe descriptor maps preserve __proto__ as an own data-property key","kind":"positive","platform":"common"}
test('Safe descriptor maps preserve __proto__ as an own data-property key', () => {
	const result = compileSource({
		id: 1,
		path: 'ffi-safe-descriptor-keys.virune',
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
