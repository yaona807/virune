import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
	classifyChangedPaths,
	isDocumentationPath,
	isSelfhostInventoryPath,
	isSelfhostRequiredGatePath,
} from './classify-ci-changes.mjs';

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));

test('classifies maintained Markdown documentation as documentation-only', () => {
	const result = classifyChangedPaths([
		'README.md',
		'docs/language-guide.md',
		'docs/language-guide_ja.md',
		'.github/PULL_REQUEST_TEMPLATE/self-hosting.md',
		'.github/self-hosting-operations/README.md',
		'.github/self-hosting-operations/README_ja.md',
	]);
	assert.equal(result.docsOnly, true);
	assert.equal(result.selfhostInventoryRequired, false);
	assert.equal(result.selfhostRequiredGateRequired, false);
	assert.equal(result.changedCount, 6);
});

test('requires the full gate for workflow, dependency, source, schema, and executable policy changes', () => {
	for (const path of [
		'.github/workflows/ci.yml',
		'.github/PULL_REQUEST_TEMPLATE/config.yml',
		'.github/self-hosting-operations/schema.json',
		'package-lock.json',
		'packages/compiler/src/compiler.ts',
		'docs/documentation-examples.json',
		'scripts/classify-ci-changes.mjs',
		'spec/grammar.ebnf',
	]) {
		assert.equal(classifyChangedPaths(['README.md', path]).docsOnly, false, path);
	}
});

test('requires self-host inventory for compiler-boundary and cross-cutting changes', () => {
	for (const path of [
		'.github/workflows/ci.yml',
		'package.json',
		'package-lock.json',
		'tsconfig.base.json',
		'packages/compiler/package.json',
		'packages/compiler/src/project/compiler.ts',
		'packages/compiler/test/selfhost-full-language-inventory.test.ts',
		'packages/runtime/src/variant.ts',
		'scripts/run-selfhost-full-language-inventory.mjs',
		'scripts/verify-selfhost-seed.mjs',
		'selfhost/mvp/src/main.virune',
		'spec/grammar.ebnf',
	]) {
		assert.equal(classifyChangedPaths([path]).selfhostInventoryRequired, true, path);
	}
});

test('keeps Required Shadow narrower than compiler-wide inventory while fail-closing self-host controls', () => {
	for (const path of [
		'.github/self-hosting/promotion-policy-v1.json',
		'.github/self-hosting/stage0-seed.json',
		'.github/workflows/selfhost-clean-bootstrap.yml',
		'.github/workflows/selfhost-fixed-seed.yml',
		'.github/workflows/nightly.yml',
		'package-lock.json',
		'packages/compiler/src/selfhost/project-compiler-adapter.ts',
		'packages/compiler/test/selfhost-ready.test.ts',
		'packages/runtime/src/variant.ts',
		'scripts/classify-ci-changes.mjs',
		'scripts/compare-selfhost-clean-bootstrap-evidence.mjs',
		'scripts/run-selfhost-release-gate.mjs',
		'selfhost/mvp/src/main.virune',
	]) {
		assert.equal(classifyChangedPaths([path]).selfhostRequiredGateRequired, true, path);
	}
	for (const path of [
		'.github/workflows/ci.yml',
		'packages/compiler/src/project/compiler.ts',
		'packages/compiler/src/parser.ts',
		'packages/cli/src/main.ts',
		'spec/grammar.ebnf',
	]) {
		assert.equal(classifyChangedPaths([path]).selfhostRequiredGateRequired, false, path);
	}
});

test('skips self-host inventory for unrelated product and documentation changes', () => {
	for (const path of [
		'README.md',
		'docs/language-guide.md',
		'packages/cli/src/main.ts',
		'packages/language-server/src/server.ts',
		'packages/vscode/src/extension.ts',
	]) {
		assert.equal(classifyChangedPaths([path]).selfhostInventoryRequired, false, path);
	}
});

test('does not treat an empty change set as documentation-only and fails safe for inventory', () => {
	assert.deepEqual(classifyChangedPaths([]), {
		docsOnly: false,
		selfhostInventoryRequired: true,
		selfhostRequiredGateRequired: true,
		changedCount: 0,
		paths: [],
	});
});

test('normalizes separators and removes duplicate paths', () => {
	const result = classifyChangedPaths(['docs\\guide.md', 'docs/guide.md', '']);
	assert.deepEqual(result, {
		docsOnly: true,
		selfhostInventoryRequired: false,
		selfhostRequiredGateRequired: false,
		changedCount: 1,
		paths: ['docs/guide.md'],
	});
});

test('limits documentation paths to reviewed Markdown locations', () => {
	assert.equal(isDocumentationPath('SECURITY.md'), true);
	assert.equal(isDocumentationPath('docs/release-channels.md'), true);
	assert.equal(isDocumentationPath('.github/PULL_REQUEST_TEMPLATE/self-hosting.md'), true);
	assert.equal(isDocumentationPath('.github/self-hosting-operations/README_ja.md'), true);
	assert.equal(isDocumentationPath('.github/README.md'), false);
	assert.equal(isDocumentationPath('.github/PULL_REQUEST_TEMPLATE/config.yml'), false);
	assert.equal(isDocumentationPath('docs/schema.json'), false);
});

test('self-host inventory path rules are repository-owned and conservative', () => {
	assert.equal(isSelfhostInventoryPath('selfhost/mvp/src/main.virune'), true);
	assert.equal(isSelfhostInventoryPath('packages/compiler/src/compiler.ts'), true);
	assert.equal(isSelfhostInventoryPath('packages/compiler/test/selfhost-ready.test.ts'), true);
	assert.equal(isSelfhostInventoryPath('packages/runtime/src/variant.ts'), true);
	assert.equal(isSelfhostInventoryPath('scripts/run-selfhost-focused.mjs'), true);
	assert.equal(isSelfhostInventoryPath('packages/vscode/src/extension.ts'), false);
});

test('Required Shadow path rules preserve Stage 3 and defer compiler-wide Stage 4', () => {
	assert.equal(isSelfhostRequiredGatePath('.github/self-hosting/promotion-policy-v1.json'), true);
	assert.equal(isSelfhostRequiredGatePath('.github/workflows/selfhost-clean-bootstrap.yml'), true);
	assert.equal(isSelfhostRequiredGatePath('packages/compiler/src/selfhost/bootstrap-stage-loader.ts'), true);
	assert.equal(isSelfhostRequiredGatePath('scripts/run-selfhost-release-gate.mjs'), true);
	assert.equal(isSelfhostRequiredGatePath('packages/compiler/src/project/compiler.ts'), false);
	assert.equal(isSelfhostRequiredGatePath('packages/vscode/src/extension.ts'), false);
});

test('writes the inventory decision to GitHub output', async t => {
	const root = await mkdtemp(join(tmpdir(), 'virune-classifier-output-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	const pathsFile = join(root, 'paths.txt');
	const outputFile = join(root, 'github-output.txt');
	await writeFile(pathsFile, 'selfhost/mvp/src/main.virune\n', 'utf8');
	const result = spawnSync(process.execPath, [
		'scripts/classify-ci-changes.mjs',
		'--paths-file',
		pathsFile,
		'--github-output',
		outputFile,
	], {
		cwd: repositoryRoot,
		encoding: 'utf8',
		maxBuffer: 16 * 1024 * 1024,
	});
	assert.equal(result.status, 0, result.stderr || result.stdout);
	const output = await readFile(outputFile, 'utf8');
	assert.match(output, /^docs_only=false$/mu);
	assert.match(output, /^selfhost_inventory_required=true$/mu);
	assert.match(output, /^selfhost_required_gate_required=true$/mu);
	assert.match(output, /^changed_count=1$/mu);
});

test('keeps the inventory check visible while gating heavy work with the classifier output', async () => {
	const workflow = await readFile(resolve(repositoryRoot, '.github/workflows/ci.yml'), 'utf8');
	assert.match(
		workflow,
		/selfhost_inventory_required: \$\{\{ steps\.changes\.outputs\.selfhost_inventory_required \}\}/u,
	);
	assert.match(
		workflow,
		/- name: Validate inventory decision[\s\S]*SELFHOST_INVENTORY_REQUIRED: \$\{\{ needs\.classify\.outputs\.selfhost_inventory_required \}\}[\s\S]*true\|false\) ;;/u,
	);
	assert.match(
		workflow,
		/- name: Record inventory omission\n        if: needs\.classify\.outputs\.selfhost_inventory_required == 'false'/u,
	);
	assert.match(
		workflow,
		/- name: Run full-language inventory\n        if: needs\.classify\.outputs\.selfhost_inventory_required == 'true'/u,
	);
	assert.match(workflow, /needs\.selfhost-inventory\.result == 'success'/u);
});

test('runs self-host CI triage and temporary-artifact policy tests', () => {
	const result = spawnSync(process.execPath, [
		'--test',
		'scripts/classify-selfhost-ci-failure.test.mjs',
		'scripts/verify-selfhost-temporary-artifacts.test.mjs',
	], {
		cwd: repositoryRoot,
		encoding: 'utf8',
		maxBuffer: 16 * 1024 * 1024,
	});
	assert.equal(result.status, 0, result.stderr || result.stdout);
});

test('requires the current tracked tree to declare every temporary artifact', () => {
	const result = spawnSync(process.execPath, [
		'scripts/verify-selfhost-temporary-artifacts.mjs',
	], {
		cwd: repositoryRoot,
		encoding: 'utf8',
		maxBuffer: 16 * 1024 * 1024,
	});
	assert.equal(result.status, 0, result.stderr || result.stdout);
	const evidence = JSON.parse(result.stdout);
	assert.equal(evidence.claim, 'selfhost-temporary-artifact-inventory');
});
