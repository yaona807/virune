import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { buildProject } from '../src/project/project.js';

const config = JSON.stringify({
	languageVersion: '1.0',
	platform: 'node',
	sourceDir: 'src',
	outDir: 'dist',
	entry: 'src/main.virune',
	target: 'es2022',
	sourceMap: true,
	sourcesContent: true,
});

test('top-level value annotations obey private/internal/public visibility ordering', async () => {
	await mkdir(resolve('.cache'), { recursive: true });
	const root = await mkdtemp(join(resolve('.cache'), 'internal-top-level-'));
	try {
		await mkdir(join(root, 'src'), { recursive: true });
		await writeFile(join(root, 'virune.json'), config, 'utf8');
		await writeFile(join(root, 'src/main.virune'), [
			'record Private {}',
			'internal record Internal {}',
			'pub record Public {}',
			'',
			'pub const publicLeak: Internal = Internal {}',
			'internal const internalLeak: Private = Private {}',
			'internal const valid: Public = Public {}',
			'',
		].join('\n'), 'utf8');

		const result = await buildProject(root, { write: false });
		const visibilityErrors = result.diagnostics.filter(item => item.code === 'L4010');
		assert.deepEqual(visibilityErrors.map(item => item.message).sort(), [
			'Internal declaration internalLeak exposes private type Private',
			'Public declaration publicLeak exposes internal type Internal',
		]);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
