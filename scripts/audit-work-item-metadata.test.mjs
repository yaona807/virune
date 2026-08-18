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

function pullRequest(number, refs = [], { draft = false, bodyExtra = '' } = {}) {
	const referenceLines = refs.map(ref => `Refs #${ref}`).join('\n');
	return {
		number,
		state: 'open',
		draft,
		body: `${referenceLines}${referenceLines && bodyExtra ? '\n' : ''}${bodyExtra}`,
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

function providerIssue(number, overrides = {}) {
	return {
		number,
		state: 'open',
		body: null,
		assignees: [],
		labels: [{ name: 'type:feature' }],
		...overrides,
	};
}

test('parses exactly one explicit Markdown work-item role section', () => {
	assert.deepEqual(parseWorkItemRole('## Work item role\n\nImplementation\n\n## Goal\nX\n'), { status: 'valid', role: 'Implementation' });
	assert.deepEqual(parseWorkItemRole('   #### Work item role ####\nTracking\n'), { status: 'valid', role: 'Tracking' });
	assert.deepEqual(parseWorkItemRole('Work item role\n================\nImplementation\n'), { status: 'valid', role: 'Implementation' });
	assert.deepEqual(parseWorkItemRole('Work item role\n----------------\nTracking\n'), { status: 'valid', role: 'Tracking' });
	assert.deepEqual(parseWorkItemRole('Work item role\n----------------\nImplementation\nGoal\n----\nX\n'), { status: 'valid', role: 'Implementation' });
	assert.deepEqual(parseWorkItemRole('## Goal\nNo role\n'), { status: 'absent', role: null });
	assert.deepEqual(parseWorkItemRole('## Work item role\nImplementation\nextra\n'), { status: 'invalid', role: null });
	assert.deepEqual(parseWorkItemRole('## Work item role\nUnknown\n'), { status: 'invalid', role: null });
	assert.deepEqual(parseWorkItemRole('## Work item role\nImplementation\n## Work item role\nTracking\n'), { status: 'invalid', role: null });
});

test('does not treat fenced examples as role headings and rejects nested role-section content', () => {
	assert.deepEqual(parseWorkItemRole('```md\n## Work item role\nTracking\n```\n## Work item role\nImplementation\n'), { status: 'valid', role: 'Implementation' });
	assert.deepEqual(parseWorkItemRole('~~~\n## Work item role\nTracking\n~~~\n## Goal\nNo role\n'), { status: 'absent', role: null });
	assert.deepEqual(parseWorkItemRole('## Work item role\nImplementation\n### Notes\nextra\n## Goal\nX\n'), { status: 'invalid', role: null });
});

test('ignores HTML-commented role and linkage examples without hiding inline-code literals', () => {
	assert.deepEqual(
		parseWorkItemRole('<!--\n## Work item role\nTracking\n-->\n## Work item role\nImplementation\n'),
		{ status: 'valid', role: 'Implementation' },
	);
	assert.deepEqual(
		extractPlainIssueRefs('<!-- Refs #1 -->\n<!--\nRefs #2\n-->\nRefs #3\n'),
		[3],
	);
	assert.deepEqual(
		parseWorkItemRole('`<!--` is literal code\n## Work item role\nImplementation\n'),
		{ status: 'valid', role: 'Implementation' },
	);
	assert.deepEqual(extractPlainIssueRefs('`<!--` is literal code\nRefs #4\n'), [4]);
	assert.deepEqual(parseWorkItemRole('\\<!-- escaped\n## Work item role\nTracking\n'), { status: 'valid', role: 'Tracking' });
});

test('extracts only whole-line plain Refs links and supported Markdown list markers', () => {
	assert.deepEqual(extractPlainIssueRefs([
		'Refs #42',
		'- Refs #7',
		'* Refs #8',
		'+ Refs #9',
		'1. Refs #10',
		'2) Refs #11',
		'Refs #42',
	].join('\n')), [7, 8, 9, 10, 11, 42]);
});

test('ignores incidental prose, code, closing keywords, lower-case refs, and malformed linkage', () => {
	assert.deepEqual(extractPlainIssueRefs([
		'This paragraph says Refs #1 as an example.',
		'`Refs #2`',
		'> Refs #3',
		'Closes #4',
		'Fixes #5',
		'refs #6',
		'Refs #7 trailing prose',
		'    Refs #8',
		'```md',
		'Refs #9',
		'```',
		'~~~',
		'- Refs #10',
		'~~~',
		'Refs #999999999999999999999999999999999999',
	].join('\n')), []);
});

test('treats an Implementation Issue referenced by an open Draft PR as active', () => {
	const report = auditWorkItemMetadata(snapshot({
		issues: [issue(10, { assignees: ['yaona807'] })],
		pullRequests: [pullRequest(20, [10], { draft: true })],
	}));
	assert.deepEqual(report.activeImplementationIssues, [{ issueNumber: 10, pullRequestNumbers: [20] }]);
	assert.deepEqual(report.findings, []);
});

test('does not activate an Implementation Issue from incidental PR body text', () => {
	const report = auditWorkItemMetadata(snapshot({
		issues: [issue(10)],
		pullRequests: [pullRequest(20, [], { draft: true, bodyExtra: 'Example: Refs #10\n```\nRefs #10\n```' })],
	}));
	assert.deepEqual(report.activeImplementationIssues, []);
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

test('audits Type and Priority cardinality for explicit work items', () => {
	const report = auditWorkItemMetadata(snapshot({
		issues: [
			issue(10, { role: 'Tracking', labels: [] }),
			issue(11, { role: 'Tracking', labels: ['type:bug', 'type:test', 'priority:p1', 'priority:p2'] }),
		],
	}));
	assert.deepEqual(report.findings, [
		{ code: 'TYPE_LABEL_CARDINALITY', subject: 'issue', number: 10, message: 'Expected exactly one type:* label, found 0' },
		{ code: 'PRIORITY_LABEL_CARDINALITY', subject: 'issue', number: 11, message: 'Expected at most one priority:* label, found 2' },
		{ code: 'TYPE_LABEL_CARDINALITY', subject: 'issue', number: 11, message: 'Expected exactly one type:* label, found 2' },
	]);
});

test('reports unknown labels in every governed taxonomy prefix', () => {
	const report = auditWorkItemMetadata(snapshot({
		issues: [issue(10, {
			role: 'Tracking',
			labels: ['area:unknown', 'priority:urgent', 'type:unknown', 'workflow:mystery'],
		})],
	}));
	assert.deepEqual(report.findings, [
		{ code: 'UNKNOWN_TAXONOMY_LABEL', subject: 'issue', number: 10, message: 'Unknown area taxonomy label: area:unknown' },
		{ code: 'UNKNOWN_TAXONOMY_LABEL', subject: 'issue', number: 10, message: 'Unknown priority taxonomy label: priority:urgent' },
		{ code: 'UNKNOWN_TAXONOMY_LABEL', subject: 'issue', number: 10, message: 'Unknown type taxonomy label: type:unknown' },
		{ code: 'UNKNOWN_TAXONOMY_LABEL', subject: 'issue', number: 10, message: 'Unknown workflow taxonomy label: workflow:mystery' },
	]);
});

test('reports malformed role and metadata drift without inferring an active role', () => {
	const report = auditWorkItemMetadata(snapshot({
		issues: [issue(11, { role: 'Implementation\nTracking', labels: [] })],
		pullRequests: [pullRequest(20, [11])],
	}));
	assert.deepEqual(report.activeImplementationIssues, []);
	assert.deepEqual(report.findings, [
		{ code: 'TYPE_LABEL_CARDINALITY', subject: 'issue', number: 11, message: 'Expected exactly one type:* label, found 0' },
		{ code: 'WORK_ITEM_ROLE_INVALID', subject: 'issue', number: 11, message: 'Work item role section must contain exactly one value: Implementation or Tracking' },
	]);
});

test('ignores metadata on Issues with no work-item role heading', () => {
	const report = auditWorkItemMetadata(snapshot({
		issues: [issue(10, { role: null, labels: ['type:unknown', 'priority:p0', 'priority:p1'] })],
	}));
	assert.deepEqual(report.findings, []);
});

test('keeps report ordering deterministic when normalized provider order changes', () => {
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
	assert.deepEqual(first.activeImplementationIssues, [{ issueNumber: 20, pullRequestNumbers: [30, 40] }]);
});

test('report does not persist Issue or PR bodies or wall-clock metadata', () => {
	const report = auditWorkItemMetadata(snapshot({
		issues: [issue(10, { role: 'Tracking', bodyExtra: 'SECRET_ISSUE_SENTINEL' })],
		pullRequests: [pullRequest(20, [], { bodyExtra: 'SECRET_PR_SENTINEL' })],
	}));
	const serialized = JSON.stringify(report);
	assert.equal(serialized.includes('SECRET_ISSUE_SENTINEL'), false);
	assert.equal(serialized.includes('SECRET_PR_SENTINEL'), false);
	assert.equal(Object.hasOwn(report, 'timestamp'), false);
	assert.equal(Object.hasOwn(report, 'generatedAt'), false);
});

test('rejects malformed normalized snapshots instead of auditing unknown state', () => {
	assert.throws(() => auditWorkItemMetadata({ schemaVersion: 2, repository: 'yaona807/virune', issues: [], pullRequests: [] }), /schemaVersion must be 1/u);
	assert.throws(() => auditWorkItemMetadata({ schemaVersion: 1, repository: 'yaona807/virune?state=closed', issues: [], pullRequests: [] }), /snapshot\.repository must use owner\/name form/u);
	assert.throws(() => auditWorkItemMetadata(snapshot({ issues: [issue(10), issue(10)] })), /duplicates issue number 10/u);
	assert.throws(() => auditWorkItemMetadata(snapshot({ pullRequests: [pullRequest(20), pullRequest(20)] })), /duplicates PR number 20/u);
	assert.throws(() => auditWorkItemMetadata(snapshot({ issues: [issue(10)], pullRequests: [pullRequest(10)] })), /Issue\/PR number overlap 10/u);
	const malformedLabels = snapshot({ issues: [issue(10)] });
	malformedLabels.issues[0].labels = ['type:test', 'area:dx'];
	assert.throws(() => auditWorkItemMetadata(malformedLabels), /labels must be sorted and unique/u);
	const malformedDraft = snapshot({ pullRequests: [pullRequest(20)] });
	malformedDraft.pullRequests[0].draft = 'false';
	assert.throws(() => auditWorkItemMetadata(malformedDraft), /draft must be a boolean/u);
});

test('collects GitHub provider pages, filters PR entries from Issues, and normalizes ordering', async () => {
	const issueItems = Array.from({ length: 100 }, (_, index) => providerIssue(index + 2));
	issueItems[0] = { number: 999, state: 'open', body: null, assignees: [], labels: [], pull_request: {} };
	const responses = new Map([
		['issues:1', issueItems],
		['issues:2', [providerIssue(1, {
			body: '## Work item role\r\n\r\nTracking\r\n',
			assignees: [{ login: 'z' }, { login: 'a' }, { login: 'z' }],
			labels: [{ name: 'type:feature' }, { name: 'area:dx' }, { name: 'area:dx' }],
		})]],
		['pulls:1', [{ number: 1007, state: 'open', draft: true, body: 'Refs #1' }]],
	]);
	const fetchImpl = async url => {
		const resource = url.includes('/issues?') ? 'issues' : 'pulls';
		const page = new URL(url).searchParams.get('page');
		const data = responses.get(`${resource}:${page}`) ?? [];
		return { ok: true, status: 200, json: async () => data };
	};
	const result = await collectGitHubWorkItems({ repository: 'yaona807/virune', token: 'token', fetchImpl });
	assert.equal(result.issues[0].number, 1);
	assert.equal(result.issues[0].body.includes('\r'), false);
	assert.deepEqual(result.issues[0].assignees, ['a', 'z']);
	assert.deepEqual(result.issues[0].labels, ['area:dx', 'type:feature']);
	assert.equal(result.issues.some(value => value.number === 999), false);
	assert.deepEqual(result.pullRequests, [{ number: 1007, state: 'open', draft: true, body: 'Refs #1' }]);
});

test('provider collection rejects duplicate normalized numbers and malformed provider state', async () => {
	const duplicateFetch = async url => ({
		ok: true,
		status: 200,
		json: async () => url.includes('/issues?') ? [providerIssue(1), providerIssue(1)] : [],
	});
	await assert.rejects(
		collectGitHubWorkItems({ repository: 'yaona807/virune', token: 'token', fetchImpl: duplicateFetch }),
		/duplicates issue number 1/u,
	);
	const malformedFetch = async url => ({
		ok: true,
		status: 200,
		json: async () => url.includes('/issues?') ? [providerIssue(1, { labels: null })] : [],
	});
	await assert.rejects(
		collectGitHubWorkItems({ repository: 'yaona807/virune', token: 'token', fetchImpl: malformedFetch }),
		/issue.labels must be an array/u,
	);
});

test('provider collection fails closed on HTTP, response-shape, token, or repository errors', async () => {
	await assert.rejects(
		collectGitHubWorkItems({ repository: 'yaona807/virune', token: 'token', fetchImpl: async () => ({ ok: false, status: 503, json: async () => [] }) }),
		/HTTP 503/u,
	);
	await assert.rejects(
		collectGitHubWorkItems({ repository: 'yaona807/virune', token: 'token', fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({}) }) }),
		/response must be an array/u,
	);
	await assert.rejects(
		collectGitHubWorkItems({ repository: 'bad repository', token: 'token', fetchImpl: async () => ({ ok: true, status: 200, json: async () => [] }) }),
		/repository must use owner\/name form/u,
	);
	await assert.rejects(
		collectGitHubWorkItems({ repository: 'yaona807/virune?state=closed', token: 'token', fetchImpl: async () => ({ ok: true, status: 200, json: async () => [] }) }),
		/repository must use owner\/name form/u,
	);
	await assert.rejects(
		collectGitHubWorkItems({ repository: 'yaona807/..', token: 'token', fetchImpl: async () => ({ ok: true, status: 200, json: async () => [] }) }),
		/repository must use owner\/name form/u,
	);
	await assert.rejects(
		collectGitHubWorkItems({ repository: 'yaona807/virune', token: '', fetchImpl: async () => ({ ok: true, status: 200, json: async () => [] }) }),
		/GitHub token is required/u,
	);
});
