import assert from 'node:assert/strict';
import test from 'node:test';
import { compileSource } from '../src/compiler.js';

const source = (path: string, text: string) => ({ id: 1, path, text });
const errors = (text: string) => compileSource(source('type-alias-line-end.virune', text), { emit: false })
	.diagnostics
	.filter(item => item.severity === 'error');

test('generic type aliases preserve the required line ending at EOF and before declarations', () => {
	const cases = [
		{
			name: 'end of file',
			text: 'type Headers = Map<String, List<String>>\n',
		},
		{
			name: 'function declaration',
			text: `type Headers = Map<String, List<String>>

fn preserveHeaders(headers: Headers) -> Headers => headers
`,
		},
		{
			name: 'record declaration',
			text: `type Headers = Map<String, List<String>>

record HeaderBox {
	headers: Headers
}
`,
		},
		{
			name: 'enum declaration',
			text: `type Headers = Map<String, List<String>>

enum HeaderState {
	Ready
}
`,
		},
		{
			name: 'attributed declaration',
			text: `type Headers = Map<String, List<String>>

@mustUse
record HeaderBox {
	headers: Headers
}
`,
		},
	];

	for (const item of cases) assert.deepEqual(errors(item.text), [], item.name);
});

test('greater-than keeps its soft line continuation inside expressions', () => {
	assert.deepEqual(errors(`fn greater(left: Int, right: Int) -> Bool {
	return left >
		right
}
`), []);
});
