import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractPlainIssueRefs, parseWorkItemRole } from './audit-work-item-metadata.mjs';

const dependabotIdentity = Object.freeze({ id: 49699333, type: 'Bot', login: 'dependabot[bot]' });
const statusContext = 'Trusted PR policy';
const markerBase = 8_000_000_000_000_000;

function requireObject(value, path) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${path} must be an object`);
	return value;
}

function requireString(value, path) {
	if (typeof value !== 'string' || value === '') throw new Error(`${path} must be a non-empty string`);
	return value;
}

function requirePositiveInteger(value, path) {
	if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${path} must be a positive safe integer`);
	return value;
}

function requireSha(value, path) {
	if (typeof value !== 'string' || !/^[0-9a-f]{40}$/u.test(value)) throw new Error(`${path} must be a lowercase 40-character SHA`);
	return value;
}

function requireRepository(value, path) {
	if (typeof value !== 'string') throw new Error(`${path} must use owner/name form`);
	const parts = value.split('/');
	if (parts.length !== 2 || parts.some(part => !/^[A-Za-z0-9_.-]+$/u.test(part) || part === '.' || part === '..')) {
		throw new Error(`${path} must use owner/name form`);
	}
	return value;
}

function normalizeBody(value, path) {
	if (value === null) return '';
	if (typeof value !== 'string') throw new Error(`${path} must be a string or null`);
	return value.replace(/\u0000/gu, '\uFFFD').replace(/\r\n?/gu, '\n');
}

function canonicalRefNumber(line) {
	const direct = /^Refs[ \t]+#([1-9][0-9]*)[ \t]*$/u.exec(line);
	if (direct !== null) return Number(direct[1]);
	const listed = /^ {0,3}(?:[-+*]|[0-9]{1,9}[.)])[ \t]+Refs[ \t]+#([1-9][0-9]*)[ \t]*$/u.exec(line);
	return listed === null ? null : Number(listed[1]);
}

function linkageProbeLine(line, marker) {
	const listed = /^( {0,3}(?:[-+*]|[0-9]{1,9}[.)])[ \t]+)Refs\b.*$/u.exec(line);
	if (listed !== null) return `${listed[1]}Refs #${marker}`;
	if (/^ {0,3}Refs\b.*$/u.test(line)) return `Refs #${marker}`;
	return null;
}

export function analyzePolicyLinkage(body) {
	const normalized = normalizeBody(body, 'body');
	const lines = normalized.split('\n');
	const refs = extractPlainIssueRefs(normalized);
	const acceptedOccurrences = [];
	const malformedLines = [];

	for (let index = 0; index < lines.length; index += 1) {
		const marker = markerBase + index;
		if (!Number.isSafeInteger(marker)) throw new Error('PR body is too large to analyze deterministically');
		const probe = linkageProbeLine(lines[index], marker);
		if (probe === null) continue;
		const mutated = [...lines];
		mutated[index] = probe;
		if (!extractPlainIssueRefs(mutated.join('\n')).includes(marker)) continue;
		const number = canonicalRefNumber(lines[index]);
		if (number === null || !Number.isSafeInteger(number)) malformedLines.push(index + 1);
		else acceptedOccurrences.push(number);
	}

	const counts = new Map();
	for (const number of acceptedOccurrences) counts.set(number, (counts.get(number) ?? 0) + 1);
	const duplicateNumbers = [...counts.entries()]
		.filter(([, count]) => count > 1)
		.map(([number]) => number)
		.sort((left, right) => left - right);

	return {
		refs,
		malformedLines: [...new Set(malformedLines)].sort((left, right) => left - right),
		duplicateNumbers,
	};
}

function isDependabot(author) {
	return author.id === dependabotIdentity.id
		&& author.type === dependabotIdentity.type
		&& author.login === dependabotIdentity.login;
}

function finding(code, message, number = null) {
	return { code, message, ...(number === null ? {} : { number }) };
}

export function evaluatePullRequestPolicy({ pullRequest, linkedIssues, closingIssues }) {
	requireObject(pullRequest, 'pullRequest');
	if (!Array.isArray(linkedIssues)) throw new Error('linkedIssues must be an array');
	if (!Array.isArray(closingIssues)) throw new Error('closingIssues must be an array');
	const number = requirePositiveInteger(pullRequest.number, 'pullRequest.number');
	const headSha = requireSha(pullRequest.headSha, 'pullRequest.headSha');
	const body = normalizeBody(pullRequest.body, 'pullRequest.body');
	if (typeof pullRequest.isFork !== 'boolean') throw new Error('pullRequest.isFork must be a boolean');
	const author = requireObject(pullRequest.author, 'pullRequest.author');
	requirePositiveInteger(author.id, 'pullRequest.author.id');
	requireString(author.type, 'pullRequest.author.type');
	requireString(author.login, 'pullRequest.author.login');

	const findings = [];
	const linkage = analyzePolicyLinkage(body);
	for (const line of linkage.malformedLines) findings.push(finding('MALFORMED_LINKAGE', `Malformed Refs linkage at source line ${line}`));
	for (const issueNumber of linkage.duplicateNumbers) findings.push(finding('DUPLICATE_LINKAGE', `Issue #${issueNumber} is referenced more than once`, issueNumber));

	const normalizedClosing = closingIssues.map((value, index) => {
		requireObject(value, `closingIssues[${index}]`);
		return {
			number: requirePositiveInteger(value.number, `closingIssues[${index}].number`),
			repository: requireRepository(value.repository, `closingIssues[${index}].repository`),
		};
	}).sort((left, right) => left.repository < right.repository ? -1 : left.repository > right.repository ? 1 : left.number - right.number);
	for (const value of normalizedClosing) {
		findings.push(finding('AUTO_CLOSE_RELATIONSHIP', `PR has an authoritative auto-close relationship to ${value.repository}#${value.number}`, value.number));
	}

	const issueByNumber = new Map();
	for (const [index, rawIssue] of linkedIssues.entries()) {
		requireObject(rawIssue, `linkedIssues[${index}]`);
		const issueNumber = requirePositiveInteger(rawIssue.number, `linkedIssues[${index}].number`);
		if (issueByNumber.has(issueNumber)) throw new Error(`linkedIssues duplicates Issue #${issueNumber}`);
		issueByNumber.set(issueNumber, rawIssue);
	}

	if (!isDependabot(author)) {
		let implementationCount = 0;
		let trackingCount = 0;
		for (const issueNumber of linkage.refs) {
			const issue = issueByNumber.get(issueNumber);
			if (issue === undefined || issue.missing === true) {
				findings.push(finding('UNKNOWN_LINKED_ISSUE', `Referenced Issue #${issueNumber} could not be resolved`, issueNumber));
				continue;
			}
			if (issue.kind === 'pull_request') {
				findings.push(finding('LINK_TARGET_IS_PR', `Refs #${issueNumber} resolves to a pull request, not an Issue`, issueNumber));
				continue;
			}
			if (issue.kind !== 'issue') {
				findings.push(finding('UNKNOWN_LINK_TARGET_KIND', `Refs #${issueNumber} has unknown provider kind`, issueNumber));
				continue;
			}
			if (issue.state === 'closed') continue;
			if (issue.state !== 'open') {
				findings.push(finding('UNKNOWN_LINKED_ISSUE_STATE', `Referenced Issue #${issueNumber} has unknown state`, issueNumber));
				continue;
			}
			const role = parseWorkItemRole(normalizeBody(issue.body ?? null, `linkedIssues[${issueNumber}].body`));
			if (role.status !== 'valid') {
				findings.push(finding('LINKED_ISSUE_ROLE_INVALID', `Open referenced Issue #${issueNumber} does not have one valid Work item role`, issueNumber));
				continue;
			}
			if (role.role === 'Implementation') implementationCount += 1;
			if (role.role === 'Tracking') trackingCount += 1;
		}
		if (implementationCount === 0) {
			findings.push(trackingCount > 0
				? finding('TRACKING_ONLY', 'PR references Tracking work but no open Implementation Issue')
				: finding('IMPLEMENTATION_LINK_REQUIRED', 'PR must reference at least one open Implementation Issue'));
		}
	}

	findings.sort((left, right) => {
		if (left.code !== right.code) return left.code < right.code ? -1 : 1;
		return (left.number ?? 0) - (right.number ?? 0);
	});
	return {
		schemaVersion: 1,
		pullRequestNumber: number,
		headSha,
		isFork: pullRequest.isFork,
		dependabotLinkageExempt: isDependabot(author),
		plainRefs: linkage.refs,
		passed: findings.length === 0,
		findings,
	};
}

async function requestJson(url, { token, fetchImpl, method = 'GET', body = undefined }) {
	const response = await fetchImpl(url, {
		method,
		headers: {
			accept: 'application/vnd.github+json',
			authorization: `Bearer ${token}`,
			'content-type': 'application/json',
			'x-github-api-version': '2022-11-28',
		},
		...(body === undefined ? {} : { body: JSON.stringify(body) }),
	});
	if (!response || typeof response.ok !== 'boolean') throw new Error('GitHub API returned an invalid response object');
	return response;
}

async function collectClosingIssues({ repository, pullRequestNumber, token, fetchImpl }) {
	const [owner, name] = repository.split('/');
	let after = null;
	const output = [];
	for (;;) {
		const response = await requestJson('https://api.github.com/graphql', {
			token,
			fetchImpl,
			method: 'POST',
			body: {
				query: 'query($owner:String!,$name:String!,$number:Int!,$after:String){repository(owner:$owner,name:$name){pullRequest(number:$number){closingIssuesReferences(first:100,after:$after){nodes{number repository{nameWithOwner}} pageInfo{hasNextPage endCursor}}}}}',
				variables: { owner, name, number: pullRequestNumber, after },
			},
		});
		if (!response.ok) throw new Error(`GitHub GraphQL request failed with HTTP ${response.status}`);
		const payload = await response.json();
		if (!payload || typeof payload !== 'object' || Array.isArray(payload) || (Array.isArray(payload.errors) && payload.errors.length > 0)) throw new Error('GitHub GraphQL returned errors or malformed data');
		const connection = payload.data?.repository?.pullRequest?.closingIssuesReferences;
		if (!connection || !Array.isArray(connection.nodes) || !connection.pageInfo || typeof connection.pageInfo.hasNextPage !== 'boolean') throw new Error('GitHub closingIssuesReferences response is malformed');
		for (const [index, node] of connection.nodes.entries()) {
			requireObject(node, `closingIssuesReferences.nodes[${index}]`);
			output.push({
				number: requirePositiveInteger(node.number, 'closing issue number'),
				repository: requireRepository(node.repository?.nameWithOwner, 'closing issue repository'),
			});
		}
		if (!connection.pageInfo.hasNextPage) return output;
		after = requireString(connection.pageInfo.endCursor, 'closingIssuesReferences.pageInfo.endCursor');
	}
}

export async function collectPullRequestPolicyInput({ repository, pullRequestNumber, expectedHeadSha, token, fetchImpl = fetch }) {
	const validatedRepository = requireRepository(repository, 'repository');
	requirePositiveInteger(pullRequestNumber, 'pullRequestNumber');
	requireSha(expectedHeadSha, 'expectedHeadSha');
	if (typeof token !== 'string' || token === '') throw new Error('GitHub token is required');
	const pullResponse = await requestJson(`https://api.github.com/repos/${validatedRepository}/pulls/${pullRequestNumber}`, { token, fetchImpl });
	if (!pullResponse.ok) throw new Error(`GitHub Pull Request request failed with HTTP ${pullResponse.status}`);
	const rawPull = requireObject(await pullResponse.json(), 'GitHub Pull Request response');
	const apiHeadSha = requireSha(rawPull.head?.sha, 'GitHub Pull Request head.sha');
	if (apiHeadSha !== expectedHeadSha) throw new Error(`PR head changed during policy evaluation: expected ${expectedHeadSha}, got ${apiHeadSha}`);
	const baseRepository = requireRepository(rawPull.base?.repo?.full_name, 'GitHub Pull Request base.repo.full_name');
	if (baseRepository !== validatedRepository) throw new Error('GitHub Pull Request base repository does not match policy repository');
	const headRepository = requireRepository(rawPull.head?.repo?.full_name, 'GitHub Pull Request head.repo.full_name');
	const pullRequest = {
		number: requirePositiveInteger(rawPull.number, 'GitHub Pull Request number'),
		headSha: apiHeadSha,
		body: normalizeBody(rawPull.body ?? null, 'GitHub Pull Request body'),
		isFork: headRepository !== validatedRepository,
		author: {
			id: requirePositiveInteger(rawPull.user?.id, 'GitHub Pull Request user.id'),
			type: requireString(rawPull.user?.type, 'GitHub Pull Request user.type'),
			login: requireString(rawPull.user?.login, 'GitHub Pull Request user.login'),
		},
	};
	const linkage = analyzePolicyLinkage(pullRequest.body);
	const linkedIssues = [];
	for (const issueNumber of linkage.refs) {
		const issueResponse = await requestJson(`https://api.github.com/repos/${validatedRepository}/issues/${issueNumber}`, { token, fetchImpl });
		if (issueResponse.status === 404) {
			linkedIssues.push({ number: issueNumber, missing: true });
			continue;
		}
		if (!issueResponse.ok) throw new Error(`GitHub Issue #${issueNumber} request failed with HTTP ${issueResponse.status}`);
		const rawIssue = requireObject(await issueResponse.json(), `GitHub Issue #${issueNumber}`);
		linkedIssues.push({
			number: requirePositiveInteger(rawIssue.number, `GitHub Issue #${issueNumber}.number`),
			kind: Object.hasOwn(rawIssue, 'pull_request') ? 'pull_request' : 'issue',
			state: rawIssue.state,
			body: rawIssue.body ?? null,
		});
	}
	const closingIssues = await collectClosingIssues({ repository: validatedRepository, pullRequestNumber, token, fetchImpl });
	return { pullRequest, linkedIssues, closingIssues };
}

export async function publishPolicyStatus({ repository, headSha, report, token, targetUrl, fetchImpl = fetch }) {
	const validatedRepository = requireRepository(repository, 'repository');
	requireSha(headSha, 'headSha');
	const state = report === null ? 'error' : report.passed ? 'success' : 'failure';
	const description = state === 'success' ? 'Trusted-base PR policy passed' : state === 'failure' ? 'Trusted-base PR policy failed' : 'Trusted-base PR policy could not evaluate';
	const response = await requestJson(`https://api.github.com/repos/${validatedRepository}/statuses/${headSha}`, {
		token,
		fetchImpl,
		method: 'POST',
		body: { state, context: statusContext, description, target_url: targetUrl },
	});
	if (!response.ok) throw new Error(`GitHub status publication failed with HTTP ${response.status}`);
}

function eventIdentity(event) {
	requireObject(event, 'event');
	return {
		repository: requireRepository(event.repository?.full_name, 'event.repository.full_name'),
		pullRequestNumber: requirePositiveInteger(event.pull_request?.number, 'event.pull_request.number'),
		headSha: requireSha(event.pull_request?.head?.sha, 'event.pull_request.head.sha'),
	};
}

async function runCli() {
	const eventPath = requireString(process.env.GITHUB_EVENT_PATH, 'GITHUB_EVENT_PATH');
	const token = requireString(process.env.GITHUB_TOKEN, 'GITHUB_TOKEN');
	const expectedRepository = requireRepository(process.env.GITHUB_REPOSITORY, 'GITHUB_REPOSITORY');
	const event = JSON.parse(await readFile(eventPath, 'utf8'));
	const identity = eventIdentity(event);
	if (identity.repository !== expectedRepository) throw new Error('event repository does not match GITHUB_REPOSITORY');
	let report = null;
	const targetUrl = `${process.env.GITHUB_SERVER_URL ?? 'https://github.com'}/${expectedRepository}/actions/runs/${requireString(process.env.GITHUB_RUN_ID, 'GITHUB_RUN_ID')}`;
	try {
		const input = await collectPullRequestPolicyInput({
			repository: identity.repository,
			pullRequestNumber: identity.pullRequestNumber,
			expectedHeadSha: identity.headSha,
			token,
		});
		report = evaluatePullRequestPolicy(input);
		process.stdout.write(`${JSON.stringify(report, null, '\t')}\n`);
		await publishPolicyStatus({ repository: expectedRepository, headSha: identity.headSha, report, token, targetUrl });
	} catch (error) {
		await publishPolicyStatus({ repository: expectedRepository, headSha: identity.headSha, report: null, token, targetUrl });
		throw error;
	}
	if (!report.passed) process.exitCode = 1;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) await runCli();
