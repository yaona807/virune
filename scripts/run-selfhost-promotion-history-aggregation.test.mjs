import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
	parsePromotionWorkflowRunEvent,
	runPromotionHistoryAggregation,
	selectInventoryForParent,
} from './run-selfhost-promotion-history-aggregation.mjs';

const repository = 'yaona807/virune';
const executionCommit = '1'.repeat(40);
const workflowPath = '.github/workflows/selfhost-promotion-observation.yml';

async function fixture({ sourceEvent = 'schedule', observationRunId = '100' } = {}) {
	const root = await mkdtemp(join(tmpdir(), 'virune-promotion-history-'));
	await mkdir(join(root, '.github', 'self-hosting'), { recursive: true });
	await writeFile(join(root, '.github', 'self-hosting', 'promotion-policy-v1.json'), JSON.stringify({ policy: true }), 'utf8');
	const eventPath = join(root, 'event.json');
	await writeFile(eventPath, JSON.stringify({
		action: 'completed',
		repository: { full_name: repository },
		workflow_run: {
			id: Number(observationRunId),
			name: 'Self-host promotion observation',
			path: workflowPath,
			head_branch: 'main',
			head_sha: executionCommit,
			event: sourceEvent,
			conclusion: 'success',
		},
	}), 'utf8');
	const output = join(root, 'github-output.txt');
	return {
		root,
		output,
		environment: {
			GITHUB_REPOSITORY: repository,
			GITHUB_TOKEN: 'token',
			GITHUB_RUN_ID: '900',
			GITHUB_RUN_ATTEMPT: '1',
			GITHUB_EVENT_PATH: eventPath,
			GITHUB_OUTPUT: output,
			VIRUNE_PROMOTION_HISTORY_OUTPUT: '.cache/history',
		},
		async cleanup() { await rm(root, { recursive: true, force: true }); },
	};
}

function baseDependencies({ observationInventory = formalInventory(), orchestrateResult = publishResult() } = {}) {
	let inventoryCalls = 0;
	return {
		createReader() { return { kind: 'reader' }; },
		async collectInventory({ workflow }) {
			inventoryCalls += 1;
			if (workflow === 'selfhost-promotion-history-aggregation.yml') return [];
			if (workflow === 'selfhost-promotion-observation.yml') return observationInventory;
			throw new Error(`unexpected workflow ${workflow}`);
		},
		async createParentCandidates() { return []; },
		discoverParent() { return { parent: null, sourceRunId: null, sourceAttempt: null, expectedLedgerSha256: null, expectedGeneration: null }; },
		async createSnapshots({ inventory }) { return inventory.map(item => ({ projected: item.runId })); },
		orchestrate() { return orchestrateResult; },
		get inventoryCalls() { return inventoryCalls; },
	};
}

function formalInventory() {
	return [{
		runId: '100',
		createdAt: '2026-08-20T18:17:00.000Z',
		executionCommit,
		status: 'completed',
		runAttempt: 1,
		attempts: [],
		artifacts: [],
	}];
}

function publishResult() {
	return {
		report: { publish: true, currentLedgerGeneration: 1 },
		serializedReport: '{"report":1}',
		reportSha256: 'a'.repeat(64),
		ledger: { generation: 1 },
		serializedLedger: '{"ledger":1}',
		ledgerSha256: 'b'.repeat(64),
		policyReplay: null,
	};
}

function noPublishResult() {
	return {
		report: { publish: false, currentLedgerGeneration: 1 },
		serializedReport: '{"report":2}',
		reportSha256: 'c'.repeat(64),
		ledger: null,
		serializedLedger: null,
		ledgerSha256: null,
		policyReplay: null,
	};
}

async function exists(path) {
	try { await access(path); return true; } catch { return false; }
}

test('publish writes exact report, ledger, and GitHub outputs', async () => {
	const f = await fixture();
	try {
		const dependencies = baseDependencies();
		const result = await runPromotionHistoryAggregation({ repositoryRoot: f.root, environment: f.environment, dependencies });
		assert.equal(await readFile(result.reportPath, 'utf8'), '{"report":1}');
		assert.equal(await readFile(result.ledgerPath, 'utf8'), '{"ledger":1}');
		assert.equal(await readFile(f.output, 'utf8'), [
			'publish=true',
			`report_sha256=${'a'.repeat(64)}`,
			`ledger_sha256=${'b'.repeat(64)}`,
			'current_generation=1',
			'',
		].join('\n'));
		assert.equal(dependencies.inventoryCalls, 2);
	} finally { await f.cleanup(); }
});

test('no-publish run removes a stale ledger from a previous execution', async () => {
	const f = await fixture();
	try {
		const outputDirectory = join(f.root, '.cache', 'history');
		await mkdir(outputDirectory, { recursive: true });
		await writeFile(join(outputDirectory, 'promotion-history-ledger.json'), 'stale-ledger', 'utf8');
		const result = await runPromotionHistoryAggregation({
			repositoryRoot: f.root,
			environment: f.environment,
			dependencies: baseDependencies({ orchestrateResult: noPublishResult() }),
		});
		assert.equal(result.ledgerPath, null);
		assert.equal(await exists(join(outputDirectory, 'promotion-history-ledger.json')), false);
		assert.equal(await readFile(join(outputDirectory, 'aggregation-report.json'), 'utf8'), '{"report":2}');
	} finally { await f.cleanup(); }
});

test('failure removes canonical report/ledger and writes only a failure diagnostic', async () => {
	const f = await fixture();
	try {
		const outputDirectory = join(f.root, '.cache', 'history');
		await mkdir(outputDirectory, { recursive: true });
		await writeFile(join(outputDirectory, 'aggregation-report.json'), 'stale-report', 'utf8');
		await writeFile(join(outputDirectory, 'promotion-history-ledger.json'), 'stale-ledger', 'utf8');
		const dependencies = baseDependencies();
		dependencies.collectInventory = async () => { throw new Error('provider unavailable'); };
		await assert.rejects(
			() => runPromotionHistoryAggregation({ repositoryRoot: f.root, environment: f.environment, dependencies }),
			/provider unavailable/u,
		);
		assert.equal(await exists(join(outputDirectory, 'aggregation-report.json')), false);
		assert.equal(await exists(join(outputDirectory, 'promotion-history-ledger.json')), false);
		const failure = JSON.parse(await readFile(join(outputDirectory, 'aggregation-failure.json'), 'utf8'));
		assert.equal(failure.status, 'failed');
		assert.equal(failure.errorMessage, 'provider unavailable');
	} finally { await f.cleanup(); }
});

test('scheduled trigger must appear in complete formal schedule inventory', async () => {
	const f = await fixture();
	try {
		await assert.rejects(
			() => runPromotionHistoryAggregation({
				repositoryRoot: f.root,
				environment: f.environment,
				dependencies: baseDependencies({ observationInventory: [] }),
			}),
			/absent from the complete formal-run inventory/u,
		);
	} finally { await f.cleanup(); }
});

test('manual trigger can aggregate existing schedule history without counting itself', async () => {
	const f = await fixture({ sourceEvent: 'workflow_dispatch', observationRunId: '777' });
	try {
		const dependencies = baseDependencies({ observationInventory: formalInventory(), orchestrateResult: noPublishResult() });
		await assert.doesNotReject(() => runPromotionHistoryAggregation({ repositoryRoot: f.root, environment: f.environment, dependencies }));
	} finally { await f.cleanup(); }
});

test('parent resume keeps every provider-visible retained run so frozen late reruns remain auditable', () => {
	const inventory = [
		{ runId: '99', createdAt: '2026-08-19T18:17:00.000Z', executionCommit: '0'.repeat(40) },
		{ runId: '100', createdAt: '2026-08-20T18:17:00.000Z', executionCommit },
		{ runId: '101', createdAt: '2026-08-21T18:17:00.000Z', executionCommit: '2'.repeat(40) },
	];
	const parent = { runs: [
		{ runId: '99', sequenceAt: inventory[0].createdAt, executionCommit: inventory[0].executionCommit, frozen: true },
		{ runId: '100', sequenceAt: inventory[1].createdAt, executionCommit, frozen: false },
	] };
	assert.deepEqual(selectInventoryForParent(inventory, parent).map(item => item.runId), ['99', '100', '101']);
	assert.throws(
		() => selectInventoryForParent(inventory, { runs: [parent.runs[0], { ...parent.runs[1], executionCommit: 'f'.repeat(40) }] }),
		/disagrees with provider identity/u,
	);
});

test('parent resume rejects provider-visible historical runs absent from the retained ledger', () => {
	const inventory = [
		{ runId: '99', createdAt: '2026-08-19T18:17:00.000Z', executionCommit: '0'.repeat(40) },
		{ runId: '100', createdAt: '2026-08-20T18:17:00.000Z', executionCommit },
	];
	const parent = { runs: [{ runId: '100', sequenceAt: inventory[1].createdAt, executionCommit, frozen: false }] };
	assert.throws(() => selectInventoryForParent(inventory, parent), /historical run 99 absent from retained ledger/u);
	assert.throws(() => selectInventoryForParent([inventory[0]], parent), /tail run 100 is absent from provider inventory/u);
});

test('workflow_run event parser requires exact workflow identity and main ref', () => {
	const base = {
		action: 'completed', repository: { full_name: repository },
		workflow_run: { id: 100, name: 'Self-host promotion observation', path: workflowPath, head_branch: 'main', head_sha: executionCommit, event: 'schedule', conclusion: 'success' },
	};
	assert.equal(parsePromotionWorkflowRunEvent(base, repository).observationRunId, '100');
	assert.throws(() => parsePromotionWorkflowRunEvent({ ...base, workflow_run: { ...base.workflow_run, name: 'Nightly quality suites' } }, repository), /unexpected triggering workflow/u);
	assert.throws(() => parsePromotionWorkflowRunEvent({ ...base, workflow_run: { ...base.workflow_run, path: '.github/workflows/impostor.yml' } }, repository), /triggering workflow path must be/u);
	assert.throws(() => parsePromotionWorkflowRunEvent({ ...base, workflow_run: { ...base.workflow_run, head_branch: 'feature' } }, repository), /must target main/u);
});
