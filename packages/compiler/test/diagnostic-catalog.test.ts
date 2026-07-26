import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

test('source diagnostic codes are stable, categorized, and machine-readable', () => {
	const result = spawnSync(process.execPath, ['scripts/diagnostic-catalog.mjs', '--json'], {
		cwd: process.cwd(),
		encoding: 'utf8',
	});
	assert.equal(result.status, 0, result.stderr);
	const document = JSON.parse(result.stdout) as {
		schemaVersion: number;
		source: string;
		diagnostics: Array<{ code: string; qualifiedCode: string; category: string; files: string[] }>;
	};
	assert.equal(document.schemaVersion, 1);
	assert.equal(document.source, 'virune');
	assert.ok(document.diagnostics.length >= 20);
	for (const diagnostic of document.diagnostics) {
		assert.match(diagnostic.code, /^L\d{4}$/u);
		assert.equal(diagnostic.qualifiedCode, `virune/${diagnostic.code}`);
		assert.match(diagnostic.category, /^(syntax|binding|type-system|control-flow|module|entry-point|internal)$/u);
		assert.ok(diagnostic.files.length > 0);
	}
});

test('published diagnostics schema fixes the v1 severity and qualified-code contract', async () => {
	const schema = JSON.parse(await readFile(resolve('packages/compiler/schema/diagnostics-v1.schema.json'), 'utf8')) as {
		properties: { schemaVersion: { const: number } };
		$defs: { diagnostic: { properties: { code: { pattern: string }; qualifiedCode: { pattern: string }; severity: { enum: string[] } } } };
	};
	assert.equal(schema.properties.schemaVersion.const, 1);
	assert.equal(schema.$defs.diagnostic.properties.code.pattern, '^L[0-9]{4}$');
	assert.equal(schema.$defs.diagnostic.properties.qualifiedCode.pattern, '^virune/L[0-9]{4}$');
	assert.deepEqual(schema.$defs.diagnostic.properties.severity.enum, ['error', 'warning', 'information', 'hint']);
});
