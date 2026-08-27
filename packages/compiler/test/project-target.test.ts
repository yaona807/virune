import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { loadConfig } from '../src/project/project.js';

// @virune-rule {"id":"module.javascript-target","runner":"unit","file":"packages/compiler/test/project-target.test.ts","case":"project configuration rejects JavaScript targets other than ES2022","kind":"negative","platform":"common"}
test('project configuration rejects JavaScript targets other than ES2022', async () => {
	const root = await mkdtemp(join(tmpdir(), 'virune-target-'));
	try {
		await writeFile(join(root, 'virune.json'), JSON.stringify({ target: 'es2023' }));
		await assert.rejects(loadConfig(root), /target must be "es2022"/u);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
