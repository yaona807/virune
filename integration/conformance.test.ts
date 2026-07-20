import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { compileSource, type Diagnostic, type SourceFile } from '@virune/compiler';
import { makeCliProject, runCli } from './cli-test-helpers.js';

test('CLI conformance compares exact status and diagnostic ranges', async () => {
	const root = await makeCliProject();
	const directory = join(root, 'conformance');
	await mkdir(directory, { recursive: true });
	const path = join(directory, 'invalid.virune');
	const text = 'fn invalid() -> String {\n\treturn 1\n}\n';
	await writeFile(path, text);
	await writeFile(`${path}.expected.json`, `${JSON.stringify({
		schemaVersion: 1,
		status: 'compile-error',
		diagnostics: [],
		rules: ['conformance.exact-diagnostics'],
	}, null, 2)}\n`);
	await assert.rejects(runCli(['test-conformance', root]));

	const source: SourceFile = { id: 1, path, text };
	const result = compileSource(source, { emit: false });
	const diagnostics = result.diagnostics.map(normalizeDiagnostic);
	await writeFile(`${path}.expected.json`, `${JSON.stringify({
		schemaVersion: 1,
		status: 'compile-error',
		diagnostics,
		rules: ['conformance.exact-diagnostics'],
	}, null, 2)}\n`);
	assert.match((await runCli(['test-conformance', root])).stdout, /1\/1 conformance files passed/u);
});

function normalizeDiagnostic(item: Diagnostic) {
	return {
		severity: item.severity,
		code: item.code,
		line: item.span.start.line,
		column: item.span.start.column,
		endLine: item.span.end.line,
		endColumn: item.span.end.column,
	};
}
