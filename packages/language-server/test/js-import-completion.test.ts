import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { jsImportCompletionItems } from '../src/features/js-import-completion.js';

async function projectFixture(t: TestContext): Promise<{ root: string; sourcePath: string }> {
	const root = await mkdtemp(join(tmpdir(), 'virune-js-import-completion-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	const sourceDirectory = join(root, 'src');
	await mkdir(sourceDirectory, { recursive: true });
	return { root, sourcePath: join(sourceDirectory, 'main.virune') };
}

async function writeDemoPackage(root: string): Promise<void> {
	const packageRoot = join(root, 'node_modules/demo-pkg');
	await mkdir(packageRoot, { recursive: true });
	await writeFile(join(packageRoot, 'package.json'), JSON.stringify({
		name: 'demo-pkg',
		version: '1.0.0',
		type: 'module',
		types: './index.d.ts',
		exports: {
			'.': {
				types: './index.d.ts',
				default: './index.js',
			},
		},
	}), 'utf8');
	await writeFile(join(packageRoot, 'index.d.ts'), [
		'export declare function makeThing(value: string): string;',
		'export declare const value: number;',
		'export interface Options { readonly enabled: boolean; }',
		'export default function defaultThing(): void;',
		'',
	].join('\n'), 'utf8');
	await writeFile(join(packageRoot, 'index.js'), [
		'export const value = 1;',
		'export function makeThing(value) { return value; }',
		'export default function defaultThing() {}',
		'',
	].join('\n'), 'utf8');
}

test('JavaScript module completion uses declared package dependencies', async t => {
	const fixture = await projectFixture(t);
	await writeFile(join(fixture.root, 'package.json'), JSON.stringify({
		dependencies: { 'alpha-lib': '1.0.0' },
		devDependencies: { '@scope/beta': '1.0.0' },
		optionalDependencies: { 'optional-lib': '1.0.0' },
	}), 'utf8');
	const source = 'import js value from "al"\n';
	const offset = source.indexOf('"al"') + 3;
	const items = await jsImportCompletionItems(fixture.root, fixture.sourcePath, source, offset);
	assert.ok(items);
	assert.deepEqual(items.map(item => item.label), ['alpha-lib']);
	assert.equal(items[0]?.textEdit?.newText, 'alpha-lib');

	const scoped = 'import js value from "@s"\n';
	const scopedItems = await jsImportCompletionItems(fixture.root, fixture.sourcePath, scoped, scoped.indexOf('@s') + 2);
	assert.ok(scopedItems);
	assert.deepEqual(scopedItems.map(item => item.label), ['@scope/beta']);
});

test('JavaScript named import completion uses TypeScript declaration exports', async t => {
	const fixture = await projectFixture(t);
	await writeDemoPackage(fixture.root);
	const source = [
		'import js {',
		'\tvalue,',
		'\tma',
		'} from "demo-pkg"',
		'',
	].join('\n');
	const offset = source.indexOf('ma') + 2;
	const items = await jsImportCompletionItems(fixture.root, fixture.sourcePath, source, offset);
	assert.ok(items);
	assert.deepEqual(items.map(item => item.label), ['makeThing']);
	assert.equal(items[0]?.textEdit?.newText, 'makeThing');
});

test('JavaScript type-only imports complete declared TypeScript types', async t => {
	const fixture = await projectFixture(t);
	await writeDemoPackage(fixture.root);
	const source = 'import js type { Op } from "demo-pkg"\n';
	const offset = source.indexOf('Op') + 2;
	const items = await jsImportCompletionItems(fixture.root, fixture.sourcePath, source, offset);
	assert.ok(items);
	assert.deepEqual(items.map(item => item.label), ['Options']);
});

test('JavaScript named import completion excludes existing and default exports', async t => {
	const fixture = await projectFixture(t);
	await writeDemoPackage(fixture.root);
	const source = 'import js { value,  } from "demo-pkg"\n';
	const offset = source.indexOf(',  }') + 2;
	const items = await jsImportCompletionItems(fixture.root, fixture.sourcePath, source, offset);
	assert.ok(items);
	const labels = items.map(item => item.label);
	assert.equal(labels.includes('value'), false);
	assert.equal(labels.includes('default'), false);
	assert.equal(labels.includes('makeThing'), true);
	assert.equal(labels.includes('Options'), true);
});

test('JavaScript import completion does not intercept ordinary Virune imports or local aliases', async t => {
	const fixture = await projectFixture(t);
	const viruneSource = 'import { helper } from "./helper.virune"\n';
	assert.equal(
		await jsImportCompletionItems(fixture.root, fixture.sourcePath, viruneSource, viruneSource.indexOf('helper') + 2),
		undefined,
	);

	const aliasSource = 'import js { helper as lo } from "demo-pkg"\n';
	assert.equal(
		await jsImportCompletionItems(fixture.root, fixture.sourcePath, aliasSource, aliasSource.indexOf('lo') + 2),
		undefined,
	);

	const emptyAliasSource = 'import js { helper as  } from "demo-pkg"\n';
	assert.equal(
		await jsImportCompletionItems(fixture.root, fixture.sourcePath, emptyAliasSource, emptyAliasSource.indexOf('as  ') + 3),
		undefined,
	);
});

test('JavaScript export completion fails soft for unresolved modules', async t => {
	const fixture = await projectFixture(t);
	const source = 'import js { Mi } from "missing-package"\n';
	const offset = source.indexOf('Mi') + 2;
	assert.deepEqual(await jsImportCompletionItems(fixture.root, fixture.sourcePath, source, offset), []);
});
