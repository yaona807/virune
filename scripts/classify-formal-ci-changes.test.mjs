import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { classifyChangedPaths } from './classify-ci-changes.mjs';
import { formalLanes, isFormalLaneRequired, normalizeChangedPaths } from './classify-formal-ci-changes.mjs';

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));

const reviewedDocumentationPaths = Object.freeze([
	'README.md',
	'README_ja.md',
	'CONTRIBUTING.md',
	'COMPATIBILITY_ja.md',
	'SECURITY.md',
	'CODE_OF_CONDUCT_ja.md',
	'.github/PULL_REQUEST_TEMPLATE/self-hosting.md',
]);

const removedDocumentationPaths = Object.freeze([
	'docs/language-guide.md',
	'docs/performance-benchmarks.md',
	'docs/adr-typescript-7-migration.md',
	'.github/self-hosting-operations/README.md',
]);

const representativeNonDocumentationPaths = Object.freeze([
	'.github/workflows/ci.yml',
	'.github/workflows/new-workflow.yml',
	'package.json',
	'package-lock.json',
	'packages/cli/src/main.ts',
	'packages/compiler/src/compiler.ts',
	'packages/runtime/src/variant.ts',
	'packages/vscode/src/extension.ts',
	'scripts/classify-ci-changes.mjs',
	'scripts/classify-formal-ci-changes.mjs',
	'scripts/verify-formal-ci-gate.mjs',
	'spec/grammar.ebnf',
	'unknown/new-area/config.bin',
]);

test('formal lane set is fixed and explicit', () => {
	assert.deepEqual(formalLanes, [
		'browser-conformance',
		'performance',
		'fixed-seed',
		'typescript7',
		'vsix',
	]);
});

test('explicit reviewed documentation-only changes omit optional formal lanes by default', () => {
	for (const lane of formalLanes) {
		assert.equal(isFormalLaneRequired(lane, reviewedDocumentationPaths), false, lane);
	}
});

test('removed documentation paths no longer retain formal-lane exemptions', () => {
	for (const path of removedDocumentationPaths) {
		assert.equal(classifyChangedPaths([path]).docsOnly, false, path);
		for (const lane of formalLanes) {
			assert.equal(isFormalLaneRequired(lane, [path]), true, `${lane}: ${path}`);
		}
	}
});

test('every non-documentation change requires every optional formal lane', () => {
	for (const path of representativeNonDocumentationPaths) {
		for (const lane of formalLanes) {
			assert.equal(isFormalLaneRequired(lane, [path]), true, `${lane}: ${path}`);
		}
	}
});

test('unknown paths fail closed instead of being inferred not-required', () => {
	for (const lane of formalLanes) {
		assert.equal(isFormalLaneRequired(lane, ['future/subsystem/new-format.xyz']), true, lane);
		assert.equal(isFormalLaneRequired(lane, ['docs/schema.json']), true, lane);
	}
});

test('preserves whitespace and literal backslashes as part of the exact changed path', () => {
	for (const path of ['docs/guide.md ', ' docs/guide.md', 'README.md ', 'docs\\guide.md']) {
		const classification = classifyChangedPaths([path]);
		assert.equal(classification.docsOnly, false, path);
		assert.deepEqual(classification.paths, [path], path);
		for (const lane of formalLanes) {
			assert.equal(isFormalLaneRequired(lane, [path]), true, `${lane}: ${path}`);
		}
	}
});

test('empty or unresolved change input fails safe by requiring every formal lane', () => {
	for (const lane of formalLanes) {
		assert.equal(isFormalLaneRequired(lane, []), true, lane);
	}
});

test('mixed documentation and code changes require every formal lane', () => {
	for (const lane of formalLanes) {
		assert.equal(
			isFormalLaneRequired(lane, ['README.md', 'packages/cli/src/main.ts']),
			true,
			lane,
		);
	}
});

test('removes only exact duplicates and empty entries while sorting exact paths deterministically', () => {
	assert.deepEqual(
		normalizeChangedPaths(['packages\\vscode\\src\\extension.ts', '', 'README.md', 'README.md', 'README.md ']),
		['README.md', 'README.md ', 'packages\\vscode\\src\\extension.ts'],
	);
});

test('rejects unknown formal lanes rather than guessing applicability', () => {
	assert.throws(() => isFormalLaneRequired('unknown', ['README.md']), /Unknown formal CI lane/u);
});

test('force-full CLI writes a canonical required decision', async t => {
	const root = await mkdtemp(join(tmpdir(), 'virune-formal-ci-classifier-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	const output = join(root, 'github-output.txt');
	const result = spawnSync(process.execPath, [
		'scripts/classify-formal-ci-changes.mjs',
		'--lane',
		'performance',
		'--force-full',
		'--github-output',
		output,
	], {
		cwd: repositoryRoot,
		encoding: 'utf8',
		maxBuffer: 16 * 1024 * 1024,
	});
	assert.equal(result.status, 0, result.stderr || result.stdout);
	assert.deepEqual(JSON.parse(result.stdout), {
		lane: 'performance',
		required: true,
		changedCount: 0,
		paths: [],
	});
	const githubOutput = await readFile(output, 'utf8');
	assert.match(githubOutput, /^formal_required=true$/mu);
	assert.match(githubOutput, /^changed_count=0$/mu);
});

test('CLI rejects a missing or unknown lane fail closed', () => {
	for (const args of [
		['--force-full'],
		['--lane', 'unknown', '--force-full'],
	]) {
		const result = spawnSync(process.execPath, ['scripts/classify-formal-ci-changes.mjs', ...args], {
			cwd: repositoryRoot,
			encoding: 'utf8',
			maxBuffer: 16 * 1024 * 1024,
		});
		assert.notEqual(result.status, 0, args.join(' '));
	}
});
