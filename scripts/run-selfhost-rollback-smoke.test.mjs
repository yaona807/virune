import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
	createRollbackDecisionInput,
	main,
	parseArguments,
	resolveCachePath,
	runRollbackSmoke,
} from './run-selfhost-rollback-smoke.mjs';

const commit = 'a'.repeat(40);
const checkedAt = '2026-08-07T12:00:00.000Z';

function successfulSelection(request) {
	return {
		rollback: {
			decision: {
				selection: 'legacy',
				rollbackRequired: true,
				reasons: [{ gate: 'performance', code: 'FAILED' }],
			},
			sha256: 'b'.repeat(64),
		},
		selection: 'legacy',
		output: {
			accepted: true,
			diagnostics: [],
			emittedModules: [{ outputPath: 'dist/main.js' }],
		},
		materializedStageArtifactSha256: null,
	};
}

function dependencies(overrides = {}) {
	return {
		readRepositoryState: async () => ({ repositoryCommit: commit, workingTreeClean: true }),
		executeBootstrapCompilerSelection: async request => successfulSelection(request),
		...overrides,
	};
}

test('parses bounded rollback smoke options', () => {
	assert.deepEqual(parseArguments([]), {
		help: false,
		json: false,
		output: '.cache/selfhost/legacy-rollback-smoke.json',
	});
	assert.deepEqual(parseArguments(['--json', '--output=.cache/custom.json']), {
		help: false,
		json: true,
		output: '.cache/custom.json',
	});
	assert.throws(() => parseArguments(['--json', '--json']), /Duplicate option/u);
	assert.throws(() => parseArguments(['--help', '--json']), /cannot be combined/u);
	assert.throws(() => parseArguments(['--unknown']), /Unknown argument/u);
});

test('restricts evidence output to repository-local JSON under .cache', () => {
	assert.equal(resolveCachePath('/repo', '.cache/result.json').repositoryRelative, '.cache/result.json');
	assert.throws(() => resolveCachePath('/repo', '../result.json'), /inside the repository|stay inside/u);
	assert.throws(() => resolveCachePath('/repo', 'result.json'), /inside \.cache/u);
	assert.throws(() => resolveCachePath('/repo', '.cache/result.txt'), /end in \.json/u);
});

test('forces Legacy rollback without reading the Self-host candidate', async () => {
	let candidateGetterObserved = false;
	const evidence = await runRollbackSmoke({
		repositoryRoot: '/repo',
		now: () => new Date(checkedAt),
		dependencies: dependencies({
			executeBootstrapCompilerSelection: async request => {
				const descriptor = Object.getOwnPropertyDescriptor(request, 'selfHostCandidate');
				candidateGetterObserved = typeof descriptor?.get === 'function';
				assert.equal(request.rollbackDecision.gates.find(gate => gate.name === 'performance')?.status, 'fail');
				assert.equal(request.rollbackDecision.gates.find(gate => gate.name === 'rollback-smoke')?.status, 'pass');
				return successfulSelection(request);
			},
		}),
	});
	assert.equal(candidateGetterObserved, true);
	assert.equal(evidence.status, 'pass');
	assert.equal(evidence.selection, 'legacy');
	assert.equal(evidence.candidateAccessed, false);
	assert.equal(evidence.materializedStageArtifactSha256, null);
	assert.equal(evidence.productionEligible, false);
	assert.equal(evidence.repositoryCommit, commit);
	assert.equal(evidence.checkedAt, checkedAt);
	assert.match(evidence.evidenceSha256, /^[0-9a-f]{64}$/u);
});

test('rejects a dirty worktree before compiler selection', async () => {
	let selectionCalls = 0;
	await assert.rejects(
		runRollbackSmoke({
			repositoryRoot: '/repo',
			dependencies: dependencies({
				readRepositoryState: async () => ({ repositoryCommit: commit, workingTreeClean: false }),
				executeBootstrapCompilerSelection: async request => {
					selectionCalls += 1;
					return successfulSelection(request);
				},
			}),
		}),
		/requires a clean Git working tree/u,
	);
	assert.equal(selectionCalls, 0);
});

test('fails closed if compiler selection touches the unavailable candidate', async () => {
	await assert.rejects(
		runRollbackSmoke({
			repositoryRoot: '/repo',
			dependencies: dependencies({
				executeBootstrapCompilerSelection: async request => request.selfHostCandidate,
			}),
		}),
		/must remain inaccessible/u,
	);
});

test('writes deterministic structural evidence through the CLI boundary', async t => {
	const repositoryRoot = await mkdtemp(join(tmpdir(), 'virune-rollback-smoke-test-'));
	t.after(() => rm(repositoryRoot, { recursive: true, force: true }));
	const evidence = await main(['--output=.cache/evidence.json'], {
		repositoryRoot,
		now: () => new Date(checkedAt),
		dependencies: dependencies(),
	});
	assert.equal(evidence.status, 'pass');
	const written = JSON.parse(await readFile(join(repositoryRoot, '.cache/evidence.json'), 'utf8'));
	assert.deepEqual(written, evidence);
});

test('rollback decision probe uses one canonical failure and keeps rollback-smoke passing', () => {
	const decision = createRollbackDecisionInput(checkedAt);
	assert.deepEqual(
		decision.gates.filter(gate => gate.status === 'fail').map(gate => gate.name),
		['performance'],
	);
	assert.equal(decision.gates.find(gate => gate.name === 'rollback-smoke')?.status, 'pass');
	assert.equal(decision.evaluatedAt, checkedAt);
});
