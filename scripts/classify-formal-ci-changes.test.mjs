import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { formalLanes, isFormalLaneRequired, normalizeChangedPaths } from './classify-formal-ci-changes.mjs';

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));

const representativeRequiredPaths = Object.freeze({
	'browser-conformance': [
		'.github/workflows/browser-conformance.yml',
		'integration/browser.test.ts',
		'packages/compiler/src/compiler.ts',
		'packages/runtime/src/variant.ts',
		'packages/stdlib/src/index.ts',
		'package.json',
		'package-lock.json',
	],
	performance: [
		'.github/workflows/performance.yml',
		'benchmarks/performance/baseline.json',
		'docs/performance-benchmarks.md',
		'packages/compiler/src/compiler.ts',
		'packages/js-interop/src/index.ts',
		'packages/language-server/src/server.ts',
		'scripts/check-performance-regression.mjs',
		'tsconfig.json',
	],
	'fixed-seed': [
		'.github/workflows/selfhost-fixed-seed.yml',
		'.github/self-hosting/stage0-seed.json',
		'packages/compiler/src/compiler.ts',
		'selfhost/mvp/src/main.virune',
		'scripts/run-selfhost-fixed-seed-bootstrap.test.mjs',
		'package-lock.json',
	],
	typescript7: [
		'.github/typescript-version-policy.json',
		'.github/workflows/typescript-7-prototype.yml',
		'docs/adr-typescript-7-migration-boundary.md',
		'packages/js-interop/src/index.ts',
		'packages/language-server/src/server.ts',
		'packages/vscode/package.json',
		'packages/compiler/tsconfig.json',
		'scripts/verify-typescript-boundary.test.mjs',
		'tsconfig.base.json',
	],
	vsix: [
		'.github/workflows/vsix-smoke.yml',
		'packages/vscode/src/extension.ts',
		'packages/language-server/src/server.ts',
		'scripts/build-vscode.mjs',
		'scripts/vsix-smoke.test.mjs',
		'scripts/vsix-smoke-harness/fixture.mjs',
		'package-lock.json',
	],
});

const representativeUnrelatedPaths = Object.freeze({
	'browser-conformance': ['packages/cli/src/main.ts', 'docs/language-guide.md'],
	performance: ['packages/runtime/src/variant.ts', 'README.md'],
	'fixed-seed': ['packages/vscode/src/extension.ts', 'docs/language-guide.md'],
	typescript7: ['packages/runtime/src/variant.ts', 'README.md'],
	vsix: ['packages/compiler/src/compiler.ts', 'docs/language-guide.md'],
});

test('formal lane set is fixed and explicit', () => {
	assert.deepEqual(formalLanes, [
		'browser-conformance',
		'performance',
		'fixed-seed',
		'typescript7',
		'vsix',
	]);
});

test('each formal lane accepts its reviewed impact paths', () => {
	for (const lane of formalLanes) {
		for (const path of representativeRequiredPaths[lane]) {
			assert.equal(isFormalLaneRequired(lane, [path]), true, `${lane}: ${path}`);
		}
	}
});

test('each formal lane explicitly omits unrelated paths', () => {
	for (const lane of formalLanes) {
		for (const path of representativeUnrelatedPaths[lane]) {
			assert.equal(isFormalLaneRequired(lane, [path]), false, `${lane}: ${path}`);
		}
	}
});

test('shared classifier controls force every formal lane to run', () => {
	for (const path of [
		'scripts/classify-ci-changes.mjs',
		'scripts/classify-ci-changes.test.mjs',
		'scripts/classify-formal-ci-changes.mjs',
		'scripts/classify-formal-ci-changes.test.mjs',
	]) {
		for (const lane of formalLanes) {
			assert.equal(isFormalLaneRequired(lane, [path]), true, `${lane}: ${path}`);
		}
	}
});

test('empty or unknown change input fails safe by requiring every formal lane', () => {
	for (const lane of formalLanes) {
		assert.equal(isFormalLaneRequired(lane, []), true, lane);
	}
});

test('mixed changes require a lane when any reviewed path requires it', () => {
	assert.equal(
		isFormalLaneRequired('browser-conformance', ['README.md', 'packages/runtime/src/variant.ts']),
		true,
	);
	assert.equal(
		isFormalLaneRequired('vsix', ['README.md', 'packages/compiler/src/compiler.ts']),
		false,
	);
});

test('normalizes separators, removes duplicates, and sorts deterministically', () => {
	assert.deepEqual(
		normalizeChangedPaths(['packages\\vscode\\src\\extension.ts', '', 'README.md', 'README.md']),
		['README.md', 'packages/vscode/src/extension.ts'],
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
