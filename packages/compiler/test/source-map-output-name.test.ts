import assert from 'node:assert/strict';
import test from 'node:test';
import { compileSource } from '../src/compiler.js';

const source = {
	id: 1,
	path: '/workspace/src/main.virune',
	text: 'fn value() -> Int {\n\treturn 1\n}\n',
} as const;

function compile(outputFile?: string, sourceMap = true) {
	const result = compileSource(source, {
		...(outputFile === undefined ? {} : { outputFile }),
		sourceMap,
	});
	assert.deepEqual(result.diagnostics.filter(item => item.severity === 'error'), []);
	assert.ok(result.output !== undefined);
	return result.output;
}

test('sourceMappingURL follows the requested output artifact basename', () => {
	const output = compile('/workspace/dist/chunks/main.jsx');
	const map = JSON.parse(output.map) as { file?: string };

	assert.match(output.code, /\/\/# sourceMappingURL=main\.jsx\.map\n$/u);
	assert.doesNotMatch(output.code, /sourceMappingURL=.*(?:dist|chunks)[\\/]/u);
	assert.equal(map.file, 'main.jsx');
});

test('default JavaScript output keeps the existing .js.map reference', () => {
	const output = compile();
	const map = JSON.parse(output.map) as { file?: string };

	assert.match(output.code, /\/\/# sourceMappingURL=main\.js\.map\n$/u);
	assert.equal(map.file, 'main.js');
});

test('sourceMap false emits no sourceMappingURL for a custom output artifact', () => {
	const output = compile('/workspace/dist/main.jsx', false);

	assert.doesNotMatch(output.code, /sourceMappingURL/u);
});
