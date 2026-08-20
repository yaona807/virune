import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	analyzePolicyLinkage,
	collectPullRequestPolicyInput,
	evaluatePullRequestPolicy,
	publishPolicyStatus,
} from './evaluate-pr-policy.mjs';

const headSha = '0123456789abcdef0123456789abcdef01234567';

function pullRequest(overrides = {}) {
	return {
		number: 100,
		headSha,
		body: '## Summary\n\nChange.\n\n## Related issue\n\nRefs #10\n',
		isFork: false,
		author: { id: 72598968, type: 'User', login: 'yaona807' },
		...overrides,
	};
}

function issue(number, role = 'Implementation', overrides = {}) {
	return {
		number,
		kind: 'issue',
		state: 'open',
		body: `## Work item role\n\n${role}\n`,
		...overrides,
	};
}

function evaluate({ pr = pullRequest(), issues = [issue(10)], closing = [] } = {}) {
	return evaluatePullRequestPolicy({ pullRequest: pr, linkedIssues: issues, closingIssues: closing });
}

test('ordinary PR passes with an open Implementation Issue', () => {
	const report = evaluate();
	assert.equal(report.passed, true);
	assert.deepEqual(report.findings, []);
});

test('Tracking-only and missing Implementation linkage fail closed', () => {
	assert.deepEqual(evaluate({ issues: [issue(10, 'Tracking')] }).findings.map(value => value.code), ['TRACKING_ONLY']);
	assert.deepEqual(evaluate({ pr: pullRequest({ body: '## Summary\nNo linkage\n' }), issues: [] }).findings.map(value => value.code), ['IMPLEMENTATION_LINK_REQUIRED']);
});

test('malformed and duplicate visible Refs linkage fails without counting hidden examples', () => {
	const malformed = evaluate({ pr: pullRequest({ body: 'Refs #10 trailing\nRefs #10\n' }) });
	assert.deepEqual(malformed.findings.map(value => value.code), ['MALFORMED_LINKAGE']);
	const duplicate = evaluate({ pr: pullRequest({ body: 'Refs #10\n- Refs #10\n' }) });
	assert.deepEqual(duplicate.findings.map(value => value.code), ['DUPLICATE_LINKAGE']);
	const hidden = analyzePolicyLinkage('Refs #10\n```md\nRefs #10\n```\n');
	assert.deepEqual(hidden.duplicateNumbers, []);
	assert.deepEqual(hidden.refs, [10]);
});

test('unknown, PR-kind, and malformed open Issue targets fail closed while closed historical refs are ignored', () => {
	assert.ok(evaluate({ issues: [{ number: 10, missing: true }] }).findings.some(value => value.code === 'UNKNOWN_LINKED_ISSUE'));
	assert.ok(evaluate({ issues: [{ number: 10, kind: 'pull_request', state: 'open', body: '' }] }).findings.some(value => value.code === 'LINK_TARGET_IS_PR'));
	assert.ok(evaluate({ issues: [issue(10, 'Unknown')] }).findings.some(value => value.code === 'LINKED_ISSUE_ROLE_INVALID'));
	const report = evaluate({
		pr: pullRequest({ body: 'Refs #10\nRefs #11\n' }),
		issues: [issue(10), issue(11, 'Unknown', { state: 'closed' })],
	});
	assert.equal(report.passed, true);
});

test('authoritative GitHub auto-close relationships fail regardless of plain Refs linkage', () => {
	const report = evaluate({ closing: [{ repository: 'yaona807/virune', number: 10 }] });
	assert.ok(report.findings.some(value => value.code === 'AUTO_CLOSE_RELATIONSHIP'));
	assert.equal(report.passed, false);
});

test('Dependabot linkage exemption is bound to provider id, bot type, and login', () => {
	const body = 'Automated dependency update without implementation linkage.';
	const trusted = evaluate({
		pr: pullRequest({ body, author: { id: 49699333, type: 'Bot', login: 'dependabot[bot]' } }),
		issues: [],
	});
	assert.equal(trusted.passed, true);
	assert.equal(trusted.dependabotLinkageExempt, true);
	for (const author of [
		{ id: 49699334, type: 'Bot', login: 'dependabot[bot]' },
		{ id: 49699333, type: 'User', login: 'dependabot[bot]' },
		{ id: 49699333, type: 'Bot', login: 'dependabot' },
	]) {
		const spoofed = evaluate({ pr: pullRequest({ body, author }), issues: [] });
		assert.equal(spoofed.passed, false);
		assert.equal(spoofed.dependabotLinkageExempt, false);
	}
});

test('fork origin is explicit policy data and does not require secrets or weaker linkage', () => {
	const report = evaluate({ pr: pullRequest({ isFork: true }) });
	assert.equal(report.passed, true);
	assert.equal(report.isFork, true);
});

test('collector binds provider metadata to the event head and reads authoritative closing relationships', async () => {
	const requests = [];
	const fetchImpl = async (url, options = {}) => {
		requests.push({ url, options });
		if (url.endsWith('/pulls/100')) return {
			ok: true,
			status: 200,
			json: async () => ({
				number: 100,
				body: 'Refs #10',
				head: { sha: headSha, repo: { full_name: 'fork-owner/virune' } },
				base: { repo: { full_name: 'yaona807/virune' } },
				user: { id: 72598968, type: 'User', login: 'yaona807' },
			}),
		};
		if (url.endsWith('/issues/10')) return {
			ok: true,
			status: 200,
			json: async () => ({ number: 10, state: 'open', body: '## Work item role\nImplementation\n' }),
		};
		if (url === 'https://api.github.com/graphql') return {
			ok: true,
			status: 200,
			json: async () => ({ data: { repository: { pullRequest: { closingIssuesReferences: {
				nodes: [{ number: 20, repository: { nameWithOwner: 'yaona807/virune' } }],
				pageInfo: { hasNextPage: false, endCursor: null },
			} } } } }),
		};
		throw new Error(`unexpected request ${url}`);
	};
	const input = await collectPullRequestPolicyInput({
		repository: 'yaona807/virune',
		pullRequestNumber: 100,
		expectedHeadSha: headSha,
		token: 'token',
		fetchImpl,
	});
	assert.equal(input.pullRequest.headSha, headSha);
	assert.equal(input.pullRequest.isFork, true);
	assert.deepEqual(input.closingIssues, [{ number: 20, repository: 'yaona807/virune' }]);
	assert.ok(requests.some(value => value.url === 'https://api.github.com/graphql' && value.options.method === 'POST'));
	await assert.rejects(
		collectPullRequestPolicyInput({ repository: 'yaona807/virune', pullRequestNumber: 100, expectedHeadSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', token: 'token', fetchImpl }),
		/PR head changed during policy evaluation/u,
	);
});

test('status publication targets the exact evaluated head with a fixed context', async () => {
	let request = null;
	const fetchImpl = async (url, options) => {
		request = { url, options };
		return { ok: true, status: 201, json: async () => ({}) };
	};
	await publishPolicyStatus({
		repository: 'yaona807/virune',
		headSha,
		report: evaluate(),
		token: 'token',
		targetUrl: 'https://github.com/yaona807/virune/actions/runs/1',
		fetchImpl,
	});
	assert.equal(request.url, `https://api.github.com/repos/yaona807/virune/statuses/${headSha}`);
	const body = JSON.parse(request.options.body);
	assert.deepEqual(body, {
		state: 'success',
		context: 'Trusted PR policy',
		description: 'Trusted-base PR policy passed',
		target_url: 'https://github.com/yaona807/virune/actions/runs/1',
	});
});
