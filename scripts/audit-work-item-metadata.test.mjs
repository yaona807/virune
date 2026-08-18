import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	auditWorkItemMetadata,
	collectGitHubWorkItems,
	extractPlainIssueRefs,
	parseWorkItemRole,
} from './audit-work-item-metadata.mjs';

function issue(number, { role = 'Implementation', assignees = [], labels = ['type:feature'], bodyExtra = '' } = {}) {
	const roleSection = role === null ? '' : `## Work item role\n\n${role}\n\n`;
	return {
		number,
		state: 'open',
		body: `${roleSection}${bodyExtra}`,
		assignees: [...assignees].sort(),
		labels: [...labels].sort(),
	};
}

function pullRequest(number, refs, { draft = false, bodyExtra = '' } = {}) {
	return {
		number,
		state: 'open',
		draft,
		body: `${refs.map(ref => `Refs #${ref}`).join('\n')}\n${bodyExtra}`,
	};
}

function snapshot({ issues = [], pullRequests = [] } = {}) {
	return {
		schemaVersion: 1,
		repository: 'yaona807/virune',
		issues,
		pullRequests,
	};
}

test('parses exactly one explicit work-item role section', () => {
	assert.deepEqual(parseWorkItemRole('## Work item role\n\nImplementation\n\n## Goal\nX\n'), { status: 'valid', role: 'Implementation' });
	assert.deepEqual(parseWorkItemRole('#### Work item role\nTracking\n'), { status: 'valid', role: 'Tracking' });
	assert.deepEqual(parseWorkItemRole('## Goal\nNo role\n'), { status: 'absent', role: null });
	assert.deepEqual(parseWorkItemRole('## Work item role\nImplementation\nextra\n'), { status: 'invalid', role: null });
	assert.deepEqual(parseWorkItemRole('## Work item role\nUnknown\n'), { status: 'invalid', role: null });
	assert.deepEqual(parseWorkItemRole('## Work item role\nImplementation\n## Work item role\nTracking\n'), { status: 'invalid', role: null });
});

test('extracts only explicit plain Refs links and deduplicates them', () => {
	assert.deepEqual(extractPlainIssueRefs('Refs #42\nRefs #7\nRefs #42\nCloses #99\nrefs #10\n'), [7, 42]);
});

test('treats an Implementation Issue referenced by an open Draft PR as active', () => {
	const report = auditWorkItemMetadata(snapshot({
		issues: [issue(10, { assignees: ['yaona807'] })],
		pullRequests: [pullRequest(20, [10], { draft: true })],
	}));
	assert.deepEqual(report.activeImplementationIssues, [{ issueNumber: 10, pullRequestNumbers: [20] }]);
	assert.deepEqual(report.findings, []);
});

test('does not require backlog or Tracking Issues to have an assignee', () => {
	const report = auditWorkItemMetadata(snapshot({
		issues: [issue(10), issue(11, { role: 'Tracking' })],
		pullRequests: [],
	}));
	assert.equal(report.findingCount, 0);
});

test('reports an active Implementation Issue without an accountable assignee', () => {
	const report = auditWorkItemMetadata(snapshot({
		issues: [issue(10)],
		pullRequests: [pullRequest(20, [10])],
	}));
	assert.deepEqual(report.findings, [{
		code: 'ACTIVE_IMPLEMENTATION_UNASSIGNED',
		subject: 'issue',
		number: 10,
		message: 'Active Implementation Issue has no accountable assignee',
	}]);
});

test('audits taxonomy cardinality and known label values only for explicit work items', () => {
	const report = auditWorkItemMetadata(snapshot({
		issues: [
			issue(10, { role: null, labels: [] }),
			issue(11, { role: 'Tracking', labels: ['type:bug', 'type:test', 'priority:p1', 'priority:p2', 'area:unknown', 'workflow:mystery'] }),
		],
	}));
	assert.deepEqual(report.findings, [
		{ code: 'PRIORITY_LABEL_CARDINALITY', subject: 'issue', number: 11, message: 'Expected at most one priority:* label, found 2' },
		{ code: 'TYPE_LABEL_CARDINALITY', subject: 'issue', number: 11, message: 'Expected exactly one type:* label, found 2' },
		{ code: 'UNKNOWN_TAXONOMY_LABEL', subject: 'issue', number: 11, message: 'Unknown area taxonomy label: area:unknown' },
		{ code: 'UNKNOWN_TAXONOMY_LABEL', subject: 'issue', number: 11, message: 'Unknown workflow taxonomy label: workflow:mystery' },
	]);
});

test('reports an explicitly malformed work-item role but ignores issues with no role heading', () => {
	const report = auditWorkItemMetadata(snapshot({
		issues: [
			issue(10, { role: null }),
			issue(11, { role: 'Implementation\nTracking' }),
		],
	}));
	assert.deepEqual(report.findings, [{
		code: 'WORK_ITEM_ROLE_INVALID',
		subject: 'issue',
		number: 11,
		message: 'Work item role section must contain exactly one value: Implementation or Tracking',
	}]);
});

test('keeps output deterministic when provider input order changes', () => {
	const first = auditWorkItemMetadata(snapshot({
		issues: [
			issue(20, { assignees: [], labels: ['type:test'] }),
			issue(10, { role: 'Tracking', labels: ['area:dx', 'type:docs'] }),
		],
		pullRequests: [pullRequest(40, [20]), pullRequest(30, [20])],
	}));
	const second = auditWorkItemMetadata(snapshot({
		issues: [
			issue(10, { role: 'Tracking', labels: ['type:docs', 'area:dx'] }),
			issue(20, { assignees: [], labels: ['type:test'] }),
		],
		pullRequests: [pullRequest(30, [20]), pullRequest(40, [20])],
	}));
	assert.deepEqual(first, second);
});

test('rejects malformed normalized snapshots instead of auditing unknown state', () => {
	assert.throws(() => auditWorkItemMetadata({ schemaVersion: 2, repository: 'yaona807/virune', issues: [], pullRequests: [] }), /schemaVersion must be 1/u);
	assert.throws(() => auditWorkItemMetadata(snapshot({ issues: [issue(10), issue(10)] })), /duplicates issue number 10/u);
	const malformed = snapshot({ issues: [issue(10)] });
	malformed.issues[0].labels = ['type:test', 'area:dx'];
	assert.throws(() => auditWorkItemMetadata(malformed), /labels must be sorted and unique/u);
});

test('collects GitHub provider pages, filters pull requests from the issues endpoint, and normalizes ordering', async () => {
	const issueItems = Array.from({ length: 100 }, (_, index) => ({
		number: index + 2,
		state: 'open',
		body: null,
		assignees: [],
		labels: [{ name: 'type:feature' }],
	}));
	issueItems[0] = { number: 999, state: 'open', body: null, assignees: [], labels: [], pull_request: {} };
	const responses = new Map([
		['issues:1', issueItems],
		['issues:2', [{ number: 1, state: 'open', body: '## Work item role\n\nTracking\n', assignees: [{ login: 'z' }, { login: 'a' }], labels: [{ name: 'type:feature' }, { name: 'area:dx' }] }]],
		['pulls:1', [{ number: 7, state: 'open', draft: true, body: 'Refs #1' }]],
	]);
	const fetchImpl = async url => {
		const resource = url.includes('/issues?') ? 'issues' : 'pulls';
		const page = new URL(url).searchParams.get('page');
		const data = responses.get(`${resource}:${page}`) ?? [];
		return { ok: true, status: 200, json: async () => data };
	};
	const result = await collectGitHubWorkItems({ repository: 'yaona807/virune', token: 'token', fetchImpl });
	assert.equal(result.issues[0].number, 1);
	assert.deepEqual(result.issues[0].assignees, ['a', 'z']);
	assert.deepEqual(result.issues[0].labels, ['area:dx', 'type:feature']);
	assert.equal(result.issues.some(value => value.number === 999), false);
	assert.deepEqual(result.pullRequests, [{ number: 7, state: 'open', draft: true, body: 'Refs #1' }]);
});

test('provider collection fails closed on HTTP or response-shape errors', async () => {
	await assert.rejects(
		collectGitHubWorkItems({ repository: 'yaona807/virune', token: 'token', fetchImpl: async () => ({ ok: false, status: 503, json: async () => [] }) }),
		/HTTP 503/u,
	);
	await assert.rejects(
		collectGitHubWorkItems({ repository: 'yaona807/virune', token: 'token', fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({}) }) }),
		/response must be an array/u,
	);
});
