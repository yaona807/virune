import assert from 'node:assert/strict';
import test from 'node:test';
import {
	artifactByExactName,
	collectPromotionWorkflowInventory,
	createPromotionGitHubReader,
} from './selfhost-promotion-github.mjs';

const repository = 'yaona807/virune';
const workflow = 'selfhost-promotion-observation.yml';
const executionCommit = 'a'.repeat(40);

function jsonResponse(value, status = 200) {
	return {
		ok: status >= 200 && status < 300,
		status,
		async json() { return value; },
		async arrayBuffer() { return Buffer.from(JSON.stringify(value)).buffer; },
	};
}

function providerRun(id, overrides = {}) {
	return {
		id,
		run_attempt: 1,
		created_at: '2026-08-20T18:17:00.000Z',
		status: 'completed',
		conclusion: 'success',
		head_sha: executionCommit,
		event: 'schedule',
		head_branch: 'main',
		path: `.github/workflows/${workflow}`,
		repository: { full_name: repository },
		...overrides,
	};
}

function providerAttempt(id, overrides = {}) {
	return {
		...providerRun(id),
		run_started_at: '2026-08-20T18:17:01.000Z',
		updated_at: '2026-08-20T18:30:00.000Z',
		...overrides,
	};
}

function artifact(id, name = `selfhost-promotion-observation-100-1`) {
	return {
		id,
		name,
		expired: false,
		digest: `sha256:${'b'.repeat(64)}`,
		size_in_bytes: 123,
	};
}

test('workflow run pagination must satisfy a stable total_count exactly', async () => {
	const runs = Array.from({ length: 101 }, (_, index) => providerRun(index + 1));
	const fetchImpl = async url => {
		const page = Number(url.searchParams.get('page'));
		return jsonResponse({ total_count: 101, workflow_runs: page === 1 ? runs.slice(0, 100) : runs.slice(100) });
	};
	const reader = createPromotionGitHubReader({ repository, token: 'token', fetchImpl });
	const result = await reader.listWorkflowRuns({ workflow, event: 'schedule', branch: 'main' });
	assert.equal(result.length, 101);
});

test('pagination fails closed when total_count changes between pages', async () => {
	const runs = Array.from({ length: 100 }, (_, index) => providerRun(index + 1));
	const fetchImpl = async url => {
		const page = Number(url.searchParams.get('page'));
		return jsonResponse(page === 1
			? { total_count: 101, workflow_runs: runs }
			: { total_count: 102, workflow_runs: [providerRun(101), providerRun(102)] });
	};
	const reader = createPromotionGitHubReader({ repository, token: 'token', fetchImpl });
	await assert.rejects(
		() => reader.listWorkflowRuns({ workflow, event: 'schedule', branch: 'main' }),
		/total_count changed while paginating/u,
	);
});

test('provider HTTP failure remains a collector failure rather than artifact absence', async () => {
	const reader = createPromotionGitHubReader({ repository, token: 'token', fetchImpl: async () => jsonResponse({}, 503) });
	await assert.rejects(
		() => reader.listWorkflowRuns({ workflow, event: 'schedule', branch: 'main' }),
		/request failed with HTTP 503/u,
	);
});

test('inventory validates every historical attempt against logical run identity', async () => {
	const fetchImpl = async url => {
		const path = url.pathname;
		if (path.endsWith(`/actions/workflows/${workflow}/runs`)) return jsonResponse({ total_count: 1, workflow_runs: [providerRun(100)] });
		if (path.endsWith('/actions/runs/100/attempts/1')) return jsonResponse(providerAttempt(100));
		if (path.endsWith('/actions/runs/100/artifacts')) return jsonResponse({ total_count: 1, artifacts: [artifact(1)] });
		throw new Error(`unexpected URL ${url}`);
	};
	const reader = createPromotionGitHubReader({ repository, token: 'token', fetchImpl });
	const inventory = await collectPromotionWorkflowInventory({ reader, workflow, event: 'schedule', branch: 'main' });
	assert.equal(inventory.length, 1);
	assert.equal(inventory[0].runId, '100');
	assert.equal(inventory[0].attempts.length, 1);
	assert.equal(inventory[0].artifacts.length, 1);
});

test('attempt execution commit drift is rejected fail closed', async () => {
	const fetchImpl = async url => {
		const path = url.pathname;
		if (path.endsWith(`/actions/workflows/${workflow}/runs`)) return jsonResponse({ total_count: 1, workflow_runs: [providerRun(100)] });
		if (path.endsWith('/actions/runs/100/attempts/1')) return jsonResponse(providerAttempt(100, { head_sha: 'c'.repeat(40) }));
		if (path.endsWith('/actions/runs/100/artifacts')) return jsonResponse({ total_count: 0, artifacts: [] });
		throw new Error(`unexpected URL ${url}`);
	};
	const reader = createPromotionGitHubReader({ repository, token: 'token', fetchImpl });
	await assert.rejects(
		() => collectPromotionWorkflowInventory({ reader, workflow, event: 'schedule', branch: 'main' }),
		/attempt changed execution commit/u,
	);
});

test('duplicate exact artifact names are rejected instead of selecting one arbitrarily', () => {
	assert.throws(
		() => artifactByExactName([artifact(1), artifact(2)], 'selfhost-promotion-observation-100-1'),
		/duplicate artifact name/u,
	);
});
