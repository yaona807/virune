import { readCanonicalJsonArtifactZip } from './selfhost-promotion-artifact.mjs';

const API_ROOT = 'https://api.github.com';
const API_VERSION = '2022-11-28';
const repositoryPattern = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;
const workflowPattern = /^[A-Za-z0-9._-]+\.ya?ml$/u;
const runIdPattern = /^[1-9][0-9]*$/u;
const gitShaPattern = /^[0-9a-f]{40}$/u;

export class PromotionGitHubProviderError extends Error {
	constructor(path, message) {
		super(`${path}: ${message}`);
		this.name = 'PromotionGitHubProviderError';
		this.path = path;
	}
}

export function createPromotionGitHubReader({ repository, token, fetchImpl = fetch }) {
	if (typeof repository !== 'string' || !repositoryPattern.test(repository)) throw new PromotionGitHubProviderError('repository', 'expected owner/name');
	if (typeof token !== 'string' || token.length === 0) throw new PromotionGitHubProviderError('token', 'GitHub token is required');
	if (typeof fetchImpl !== 'function') throw new PromotionGitHubProviderError('fetchImpl', 'expected fetch function');
	const [owner, name] = repository.split('/');
	const encodedRepository = `${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
	const headers = {
		accept: 'application/vnd.github+json',
		authorization: `Bearer ${token}`,
		'x-github-api-version': API_VERSION,
	};

	async function requestJson(path, query = {}) {
		const url = apiUrl(path, query);
		const response = await request(url, headers, fetchImpl);
		try {
			return await response.json();
		} catch {
			throw new PromotionGitHubProviderError('GitHub API', 'response was not valid JSON');
		}
	}

	async function requestBytes(path) {
		const url = apiUrl(path);
		const response = await request(url, headers, fetchImpl);
		try {
			return Buffer.from(await response.arrayBuffer());
		} catch {
			throw new PromotionGitHubProviderError('GitHub API', 'artifact response could not be read as bytes');
		}
	}

	async function listWorkflowRuns({ workflow, event = undefined, branch = undefined }) {
		if (typeof workflow !== 'string' || !workflowPattern.test(workflow)) throw new PromotionGitHubProviderError('workflow', 'expected workflow filename');
		if (event !== undefined && (typeof event !== 'string' || event.length === 0)) throw new PromotionGitHubProviderError('event', 'expected non-empty event');
		if (branch !== undefined && (typeof branch !== 'string' || branch.length === 0)) throw new PromotionGitHubProviderError('branch', 'expected non-empty branch');
		return listCompleteCollection({
			requestJson,
			path: `/repos/${encodedRepository}/actions/workflows/${encodeURIComponent(workflow)}/runs`,
			itemKey: 'workflow_runs',
			query: { ...(event === undefined ? {} : { event }), ...(branch === undefined ? {} : { branch }) },
			identity: item => requirePositiveInteger(item?.id, 'workflow run id'),
		});
	}

	async function getRunAttempt(runId, attempt) {
		const canonicalRunId = requireRunId(runId, 'runId');
		const canonicalAttempt = requirePositiveInteger(attempt, 'attempt');
		const value = await requestJson(`/repos/${encodedRepository}/actions/runs/${canonicalRunId}/attempts/${canonicalAttempt}`);
		return normalizeWorkflowAttempt(value, {
			repository,
			expectedRunId: canonicalRunId,
			expectedAttempt: canonicalAttempt,
		});
	}

	async function listRunArtifacts(runId) {
		const canonicalRunId = requireRunId(runId, 'runId');
		return listCompleteCollection({
			requestJson,
			path: `/repos/${encodedRepository}/actions/runs/${canonicalRunId}/artifacts`,
			itemKey: 'artifacts',
			query: {},
			identity: item => requirePositiveInteger(item?.id, 'artifact id'),
		});
	}

	async function downloadCanonicalJsonArtifact({ artifact, expectedFileName }) {
		const normalized = normalizeArtifactMetadata(artifact);
		if (normalized.expired) throw new PromotionGitHubProviderError('artifact.expired', 'artifact has expired and cannot prove canonical evidence');
		const archive = await requestBytes(`/repos/${encodedRepository}/actions/artifacts/${normalized.id}/zip`);
		return {
			metadata: normalized,
			...readCanonicalJsonArtifactZip({
				archiveBytes: archive,
				providerDigest: normalized.digest,
				expectedFileName,
			}),
		};
	}

	return {
		repository,
		listWorkflowRuns,
		getRunAttempt,
		listRunArtifacts,
		downloadCanonicalJsonArtifact,
	};

	function apiUrl(path, query = {}) {
		const url = new URL(`${API_ROOT}${path}`);
		for (const [key, value] of Object.entries(query)) url.searchParams.set(key, String(value));
		return url;
	}
}

export async function collectPromotionWorkflowInventory({ reader, workflow, event, branch }) {
	const runs = await reader.listWorkflowRuns({ workflow, event, branch });
	const normalizedRuns = [];
	for (let index = 0; index < runs.length; index += 1) {
		const run = normalizeWorkflowRun(runs[index], { repository: reader.repository, workflow, event, branch, path: `runs[${index}]` });
		const attempts = [];
		const completedAttemptCount = run.status === 'completed' ? run.runAttempt : Math.max(0, run.runAttempt - 1);
		for (let attempt = 1; attempt <= completedAttemptCount; attempt += 1) {
			const value = await reader.getRunAttempt(run.runId, attempt);
			validateAttemptAgainstRun(value, run, workflow, event, branch, `runs[${index}].attempts[${attempt - 1}]`);
			attempts.push(value);
		}
		const artifacts = await reader.listRunArtifacts(run.runId);
		normalizedRuns.push({ ...run, attempts, artifacts: artifacts.map(normalizeArtifactMetadata) });
	}
	return normalizedRuns.sort(compareRunAscending);
}

export function artifactByExactName(artifacts, name) {
	if (!Array.isArray(artifacts)) throw new PromotionGitHubProviderError('artifacts', 'expected artifact array');
	if (typeof name !== 'string' || name.length === 0) throw new PromotionGitHubProviderError('name', 'expected non-empty artifact name');
	const matches = artifacts.filter(artifact => artifact?.name === name);
	if (matches.length > 1) throw new PromotionGitHubProviderError('artifacts', `duplicate artifact name ${name}`);
	return matches.length === 1 ? normalizeArtifactMetadata(matches[0]) : null;
}

async function listCompleteCollection({ requestJson, path, itemKey, query, identity }) {
	const perPage = 100;
	let expectedTotal = null;
	const output = [];
	const seen = new Set();
	for (let page = 1; ; page += 1) {
		if (page > 10_000) throw new PromotionGitHubProviderError(path, 'pagination exceeded the safety limit');
		const value = await requestJson(path, { ...query, per_page: perPage, page });
		if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new PromotionGitHubProviderError(path, 'expected collection object');
		const total = requireNonNegativeInteger(value.total_count, `${path}.total_count`);
		if (expectedTotal === null) expectedTotal = total;
		else if (total !== expectedTotal) throw new PromotionGitHubProviderError(path, 'total_count changed while paginating; snapshot is not complete');
		const items = value[itemKey];
		if (!Array.isArray(items)) throw new PromotionGitHubProviderError(path, `expected ${itemKey} array`);
		for (const item of items) {
			const id = String(identity(item));
			if (seen.has(id)) throw new PromotionGitHubProviderError(path, `duplicate provider item ${id}`);
			seen.add(id);
			output.push(item);
		}
		if (output.length > expectedTotal) throw new PromotionGitHubProviderError(path, 'received more items than total_count');
		if (output.length === expectedTotal) break;
		if (items.length < perPage) throw new PromotionGitHubProviderError(path, 'pagination ended before total_count was satisfied');
	}
	if (output.length !== expectedTotal) throw new PromotionGitHubProviderError(path, 'provider snapshot is incomplete');
	return output;
}

async function request(url, headers, fetchImpl) {
	let response;
	try {
		response = await fetchImpl(url, { headers, redirect: 'follow' });
	} catch {
		throw new PromotionGitHubProviderError('GitHub API', 'network request failed');
	}
	if (response === null || typeof response !== 'object' || typeof response.ok !== 'boolean') {
		throw new PromotionGitHubProviderError('GitHub API', 'provider returned an invalid response object');
	}
	if (!response.ok) throw new PromotionGitHubProviderError('GitHub API', `request failed with HTTP ${response.status}`);
	return response;
}

function normalizeWorkflowRun(value, { repository, workflow, event, branch, path }) {
	const run = providerObject(value, path);
	const runId = String(requirePositiveInteger(run.id, `${path}.id`));
	const runAttempt = requirePositiveInteger(run.run_attempt, `${path}.run_attempt`);
	const createdAt = canonicalTimestamp(run.created_at, `${path}.created_at`);
	const status = workflowStatus(run.status, `${path}.status`);
	const conclusion = status === 'completed' ? nonEmptyText(run.conclusion, `${path}.conclusion`) : nullableText(run.conclusion, `${path}.conclusion`);
	const executionCommit = canonicalGitSha(run.head_sha, `${path}.head_sha`);
	if (run.event !== event) throw new PromotionGitHubProviderError(`${path}.event`, `expected ${event}, received ${String(run.event)}`);
	if (run.head_branch !== branch) throw new PromotionGitHubProviderError(`${path}.head_branch`, `expected ${branch}, received ${String(run.head_branch)}`);
	if (run.path !== `.github/workflows/${workflow}`) throw new PromotionGitHubProviderError(`${path}.path`, `expected canonical workflow path .github/workflows/${workflow}`);
	const providerRepository = providerObject(run.repository, `${path}.repository`);
	if (providerRepository.full_name !== repository) throw new PromotionGitHubProviderError(`${path}.repository.full_name`, `expected ${repository}`);
	return { runId, runAttempt, createdAt, status, conclusion, executionCommit };
}

function normalizeWorkflowAttempt(value, { repository, expectedRunId, expectedAttempt }) {
	const run = providerObject(value, 'attempt');
	const runId = String(requirePositiveInteger(run.id, 'attempt.id'));
	if (runId !== expectedRunId) throw new PromotionGitHubProviderError('attempt.id', `expected ${expectedRunId}, received ${runId}`);
	const attempt = requirePositiveInteger(run.run_attempt, 'attempt.run_attempt');
	if (attempt !== expectedAttempt) throw new PromotionGitHubProviderError('attempt.run_attempt', `expected ${expectedAttempt}, received ${attempt}`);
	const providerRepository = providerObject(run.repository, 'attempt.repository');
	if (providerRepository.full_name !== repository) throw new PromotionGitHubProviderError('attempt.repository.full_name', `expected ${repository}`);
	const status = workflowStatus(run.status, 'attempt.status');
	if (status !== 'completed') throw new PromotionGitHubProviderError('attempt.status', 'historical attempt must be completed');
	return {
		runId,
		attempt,
		startedAt: canonicalTimestamp(run.run_started_at, 'attempt.run_started_at'),
		completedAt: canonicalTimestamp(run.updated_at, 'attempt.updated_at'),
		conclusion: nonEmptyText(run.conclusion, 'attempt.conclusion'),
		executionCommit: canonicalGitSha(run.head_sha, 'attempt.head_sha'),
		event: nonEmptyText(run.event, 'attempt.event'),
		headBranch: nonEmptyText(run.head_branch, 'attempt.head_branch'),
		workflowPath: nonEmptyText(run.path, 'attempt.path'),
	};
}

function validateAttemptAgainstRun(attempt, run, workflow, event, branch, path) {
	if (attempt.runId !== run.runId) throw new PromotionGitHubProviderError(`${path}.runId`, 'attempt changed logical run identity');
	if (attempt.executionCommit !== run.executionCommit) throw new PromotionGitHubProviderError(`${path}.executionCommit`, 'attempt changed execution commit');
	if (attempt.event !== event) throw new PromotionGitHubProviderError(`${path}.event`, `expected ${event}`);
	if (attempt.headBranch !== branch) throw new PromotionGitHubProviderError(`${path}.headBranch`, `expected ${branch}`);
	if (attempt.workflowPath !== `.github/workflows/${workflow}`) throw new PromotionGitHubProviderError(`${path}.workflowPath`, 'attempt workflow path changed');
}

function normalizeArtifactMetadata(value) {
	const artifact = providerObject(value, 'artifact');
	return {
		id: requirePositiveInteger(artifact.id, 'artifact.id'),
		name: nonEmptyText(artifact.name, 'artifact.name'),
		expired: requireBoolean(artifact.expired, 'artifact.expired'),
		digest: nonEmptyText(artifact.digest, 'artifact.digest'),
		sizeInBytes: requireNonNegativeInteger(artifact.size_in_bytes, 'artifact.size_in_bytes'),
	};
}

function workflowStatus(value, path) {
	if (value === 'queued' || value === 'in_progress' || value === 'completed') return value === 'in_progress' ? 'in-progress' : value;
	throw new PromotionGitHubProviderError(path, 'expected queued, in_progress, or completed');
}

function compareRunAscending(left, right) {
	if (left.createdAt !== right.createdAt) return left.createdAt < right.createdAt ? -1 : 1;
	const leftId = BigInt(left.runId);
	const rightId = BigInt(right.runId);
	return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
}

function providerObject(value, path) {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new PromotionGitHubProviderError(path, 'expected object');
	return value;
}

function canonicalTimestamp(value, path) {
	if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value) || new Date(value).toISOString() !== value) {
		throw new PromotionGitHubProviderError(path, 'expected canonical ISO timestamp');
	}
	return value;
}

function canonicalGitSha(value, path) {
	if (typeof value !== 'string' || !gitShaPattern.test(value)) throw new PromotionGitHubProviderError(path, 'expected lowercase 40-character Git SHA');
	return value;
}

function requireRunId(value, path) {
	const string = typeof value === 'number' ? String(value) : value;
	if (typeof string !== 'string' || !runIdPattern.test(string)) throw new PromotionGitHubProviderError(path, 'expected canonical positive decimal run ID');
	return string;
}

function requirePositiveInteger(value, path) {
	if (!Number.isSafeInteger(value) || value <= 0) throw new PromotionGitHubProviderError(path, 'expected positive safe integer');
	return value;
}

function requireNonNegativeInteger(value, path) {
	if (!Number.isSafeInteger(value) || value < 0) throw new PromotionGitHubProviderError(path, 'expected non-negative safe integer');
	return value;
}

function requireBoolean(value, path) {
	if (typeof value !== 'boolean') throw new PromotionGitHubProviderError(path, 'expected boolean');
	return value;
}

function nonEmptyText(value, path) {
	if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) throw new PromotionGitHubProviderError(path, 'expected non-empty canonical string');
	return value;
}

function nullableText(value, path) {
	return value === null ? null : nonEmptyText(value, path);
}
