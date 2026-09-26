import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { jsImportCompletionItems } from '../src/features/js-import-completion.js';

async function projectFixture(t: TestContext): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), 'virune-js-import-completion-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	return root;
}

const demoExports = [
	{ name: 'value', kind: 'const' },
	{ name: 'makeThing', kind: 'function' },
	{ name: 'Options', kind: 'interface' },
	{ name: 'default', kind: 'function' },
] as const;

test('JavaScript module completion uses declared package dependencies', async t => {
	const root = await projectFixture(t);
	await writeFile(join(root, 'package.json'), JSON.stringify({
		dependencies: { 'alpha-lib': '1.0.0' },
		devDependencies: { '@scope/beta': '1.0.0' },
		optionalDependencies: { 'optional-lib': '1.0.0' },
	}), 'utf8');
	const source = 'import js value from "al"\n';
	const offset = source.indexOf('"al"') + 3;
	const items = await jsImportCompletionItems(root, source, offset);
	assert.ok(items);
	assert.deepEqual(items.map(item => item.label), ['alpha-lib']);
	assert.equal(items[0]?.textEdit?.newText, 'alpha-lib');

	const scoped = 'import js value from "@s"\n';
	const scopedItems = await jsImportCompletionItems(root, scoped, scoped.indexOf('@s') + 2);
	assert.ok(scopedItems);
	assert.deepEqual(scopedItems.map(item => item.label), ['@scope/beta']);

	const incomplete = 'import js value from "al';
	const incompleteItems = await jsImportCompletionItems(root, incomplete, incomplete.length);
	assert.ok(incompleteItems);
	assert.deepEqual(incompleteItems.map(item => item.label), ['alpha-lib']);
	assert.equal(incompleteItems[0]?.textEdit?.newText, 'alpha-lib');
});

test('JavaScript named import completion filters resolved module exports', async t => {
	const root = await projectFixture(t);
	const source = [
		'import js {',
		'\tvalue,',
		'\tma',
		'} from "demo-pkg"',
		'',
	].join('\n');
	const offset = source.indexOf('ma') + 2;
	const items = await jsImportCompletionItems(root, source, offset, (moduleSpecifier, typeOnly) => {
		assert.equal(moduleSpecifier, 'demo-pkg');
		assert.equal(typeOnly, false);
		return demoExports;
	});
	assert.ok(items);
	assert.deepEqual(items.map(item => item.label), ['makeThing']);
	assert.equal(items[0]?.textEdit?.newText, 'makeThing');
});

test('JavaScript type-only imports request type export completion', async t => {
	const root = await projectFixture(t);
	const source = 'import js type { Op } from "demo-pkg"\n';
	const offset = source.indexOf('Op') + 2;
	const items = await jsImportCompletionItems(root, source, offset, (moduleSpecifier, typeOnly) => {
		assert.equal(moduleSpecifier, 'demo-pkg');
		assert.equal(typeOnly, true);
		return demoExports;
	});
	assert.ok(items);
	assert.deepEqual(items.map(item => item.label), ['Options']);
});

test('JavaScript named import completion excludes existing and default exports', async t => {
	const root = await projectFixture(t);
	const source = 'import js { value,  } from "demo-pkg"\n';
	const offset = source.indexOf(',  }') + 2;
	const items = await jsImportCompletionItems(root, source, offset, () => demoExports);
	assert.ok(items);
	const labels = items.map(item => item.label);
	assert.equal(labels.includes('value'), false);
	assert.equal(labels.includes('default'), false);
	assert.equal(labels.includes('makeThing'), true);
	assert.equal(labels.includes('Options'), true);
});

test('JavaScript import completion does not intercept ordinary Virune imports or local aliases', async t => {
	const root = await projectFixture(t);
	const viruneSource = 'import { helper } from "./helper.virune"\n';
	assert.equal(
		await jsImportCompletionItems(root, viruneSource, viruneSource.indexOf('helper') + 2),
		undefined,
	);

	const aliasSource = 'import js { helper as lo } from "demo-pkg"\n';
	assert.equal(
		await jsImportCompletionItems(root, aliasSource, aliasSource.indexOf('lo') + 2),
		undefined,
	);

	const emptyAliasSource = 'import js { helper as  } from "demo-pkg"\n';
	assert.equal(
		await jsImportCompletionItems(root, emptyAliasSource, emptyAliasSource.indexOf('as  ') + 3),
		undefined,
	);
});

test('JavaScript export completion fails soft when Interop cannot resolve the module', async t => {
	const root = await projectFixture(t);
	const source = 'import js { Mi } from "missing-package"\n';
	const offset = source.indexOf('Mi') + 2;
	assert.deepEqual(await jsImportCompletionItems(root, source, offset, () => []), []);
});
