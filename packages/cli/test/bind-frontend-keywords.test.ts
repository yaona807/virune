import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { generateBindings } from '../src/bind.js';

test('bindings escape component and view while preserving contextual children identifiers', async t => {
	const root = await mkdtemp(join(tmpdir(), 'virune-bind-frontend-keywords-'));
	t.after(async () => rm(root, { recursive: true, force: true }));
	const declaration = join(root, 'frontend.d.ts');
	const output = join(root, 'frontend.virune');
	await writeFile(declaration, `export interface Props {
	readonly component: string;
	readonly view: string;
	readonly children: string;
}
export function component(view: string, children: string): string;
export function view(component: string): string;
`);

	const result = await generateBindings({ cwd: root, input: declaration, output, moduleSpecifier: 'frontend-keyword-lib' });
	assert.equal(result.generatedRecords, 1);
	assert.equal(result.generatedFunctions, 2);
	const text = await readFile(output, 'utf8');
	assert.match(text, /componentValue: String/u);
	assert.match(text, /viewValue: String/u);
	assert.match(text, /children: String/u);
	assert.match(text, /pub fn componentValue\(viewValue: String, children: String\)/u);
	assert.match(text, /pub fn viewValue\(componentValue: String\)/u);
});
