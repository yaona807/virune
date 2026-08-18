import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const typeLabels = new Set([
	'type:bug', 'type:feature', 'type:refactor', 'type:test',
	'type:ci', 'type:docs', 'type:security', 'type:chore',
]);
const areaLabels = new Set([
	'area:compiler', 'area:selfhost', 'area:interop', 'area:runtime',
	'area:stdlib', 'area:cli', 'area:dx', 'area:release', 'area:governance',
]);
const priorityLabels = new Set(['priority:p0', 'priority:p1', 'priority:p2', 'priority:p3']);
const workflowLabels = new Set(['workflow:validation-only', 'workflow:superseded', 'workflow:blocked']);
const roleHeading = 'Work item role';
const validRoles = new Set(['Implementation', 'Tracking']);

export async function collectGitHubWorkItems({ repository, token, fetchImpl = fetch }) {
	if (typeof repository !== 'string' || !/^[^/\s]+\/[^/\s]+$/u.test(repository)) {
		throw new Error('repository must use owner/name form');
	}
	if (typeof token !== 'string' || token === '') throw new Error('GitHub token is required');
	const headers = {
		accept: 'application/vnd.github+json',
		authorization: `Bearer ${token}`,
		'x-github-api-version': '2022-11-28',
	};
	const issuesRaw = await fetchAllPages(`https://api.github.com/repos/${repository}/issues?state=open&per_page=100`, headers, fetchImpl);
	const pullsRaw = await fetchAllPages(`https://api.github.com/repos/${repository}/pulls?state=open&per_page=100`, headers, fetchImpl);
	const issues = issuesRaw
		.filter(issue => issue && typeof issue === 'object' && !('pull_request' in issue))
		.map(normalizeIssue)
		.sort((left, right) => left.number - right.number);
	const pullRequests = pullsRaw
		.map(normalizePullRequest)
		.sort((left, right) => left.number - right.number);
	return { schemaVersion: 1, repository, issues, pullRequests };
}

async function fetchAllPages(baseUrl, headers, fetchImpl) {
	const output = [];
	for (let page = 1; ; page += 1) {
		const separator = baseUrl.includes('?') ? '&' : '?';
		const response = await fetchImpl(`${baseUrl}${separator}page=${page}`, { headers });
		if (!response || typeof response.ok !== 'boolean') throw new Error('GitHub API returned an invalid response object');
		if (!response.ok) throw new Error(`GitHub API request failed with HTTP ${response.status}`);
		const items = await response.json();
		if (!Array.isArray(items)) throw new Error('GitHub API response must be an array');
		output.push(...items);
		if (items.length < 100) return output;
	}
}

function normalizeIssue(issue) {
	return {
		number: requirePositiveInteger(issue.number, 'issue.number'),
		state: requireOpenState(issue.state, 'issue.state'),
		body: normalizeNullableString(issue.body, 'issue.body'),
		assignees: normalizeNames(issue.assignees, 'login', 'issue.assignees'),
		labels: normalizeNames(issue.labels, 'name', 'issue.labels'),
	};
}

function normalizePullRequest(pullRequest) {
	return {
		number: requirePositiveInteger(pullRequest.number, 'pullRequest.number'),
		state: requireOpenState(pullRequest.state, 'pullRequest.state'),
		draft: requireBoolean(pullRequest.draft, 'pullRequest.draft'),
		body: normalizeNullableString(pullRequest.body, 'pullRequest.body'),
	};
}

function normalizeNullableString(value, path) {
	if (value === null) return '';
	if (typeof value !== 'string') throw new Error(`${path} must be a string or null`);
	return value.replace(/\r\n?/gu, '\n');
}

function normalizeNames(values, key, path) {
	if (!Array.isArray(values)) throw new Error(`${path} must be an array`);
	const names = values.map((value, index) => {
		if (!value || typeof value !== 'object' || typeof value[key] !== 'string' || value[key] === '') {
			throw new Error(`${path}[${index}].${key} must be a non-empty string`);
		}
		return value[key];
	});
	return [...new Set(names)].sort(compareStableStrings);
}

function requirePositiveInteger(value, path) {
	if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${path} must be a positive safe integer`);
	return value;
}

function requireOpenState(value, path) {
	if (value !== 'open') throw new Error(`${path} must be open`);
	return value;
}

function requireBoolean(value, path) {
	if (typeof value !== 'boolean') throw new Error(`${path} must be a boolean`);
	return value;
}

export function parseWorkItemRole(body) {
	if (typeof body !== 'string') throw new Error('body must be a string');
	const lines = body.replace(/\r\n?/gu, '\n').split('\n');
	const headingIndexes = [];
	for (let index = 0; index < lines.length; index += 1) {
		const match = lines[index].match(/^#{1,6}\s+(.+?)\s*$/u);
		if (match?.[1] === roleHeading) headingIndexes.push(index);
	}
	if (headingIndexes.length === 0) return { status: 'absent', role: null };
	if (headingIndexes.length !== 1) return { status: 'invalid', role: null };
	const start = headingIndexes[0] + 1;
	let end = lines.length;
	for (let index = start; index < lines.length; index += 1) {
		if (/^#{1,6}\s+/u.test(lines[index])) {
			end = index;
			break;
		}
	}
	const values = lines.slice(start, end).map(line => line.trim()).filter(Boolean);
	if (values.length !== 1 || !validRoles.has(values[0])) return { status: 'invalid', role: null };
	return { status: 'valid', role: values[0] };
}

export function extractPlainIssueRefs(body) {
	if (typeof body !== 'string') throw new Error('body must be a string');
	const numbers = new Set();
	const expression = /\bRefs\s+#([1-9][0-9]*)\b/gu;
	for (const match of body.matchAll(expression)) numbers.add(Number(match[1]));
	return [...numbers].sort((left, right) => left - right);
}

export function auditWorkItemMetadata(snapshot) {
	validateSnapshot(snapshot);
	const issues = [...snapshot.issues].sort((left, right) => left.number - right.number);
	const pullRequests = [...snapshot.pullRequests].sort((left, right) => left.number - right.number);
	const refsToPullRequests = new Map();
	for (const pullRequest of pullRequests) {
		for (const issueNumber of extractPlainIssueRefs(pullRequest.body)) {
			const references = refsToPullRequests.get(issueNumber) ?? [];
			references.push(pullRequest.number);
			refsToPullRequests.set(issueNumber, references);
		}
	}
	for (const references of refsToPullRequests.values()) references.sort((left, right) => left - right);

	const findings = [];
	const activeImplementationIssues = [];
	for (const issue of issues) {
		const role = parseWorkItemRole(issue.body);
		if (role.status === 'absent') continue;
		if (role.status === 'invalid') {
			findings.push(issueFinding('WORK_ITEM_ROLE_INVALID', issue.number, 'Work item role section must contain exactly one value: Implementation or Tracking'));
			continue;
		}
		auditTaxonomy(issue, findings);
		if (role.role !== 'Implementation') continue;
		const pullRequestNumbers = refsToPullRequests.get(issue.number) ?? [];
		if (pullRequestNumbers.length === 0) continue;
		activeImplementationIssues.push({ issueNumber: issue.number, pullRequestNumbers: [...pullRequestNumbers] });
		if (issue.assignees.length === 0) {
			findings.push(issueFinding('ACTIVE_IMPLEMENTATION_UNASSIGNED', issue.number, 'Active Implementation Issue has no accountable assignee'));
		}
	}

	findings.sort(compareFindings);
	activeImplementationIssues.sort((left, right) => left.issueNumber - right.issueNumber);
	return {
		schemaVersion: 1,
		repository: snapshot.repository,
		openIssueCount: issues.length,
		openPullRequestCount: pullRequests.length,
		activeImplementationIssues,
		findingCount: findings.length,
		findings,
	};
}

function auditTaxonomy(issue, findings) {
	const type = issue.labels.filter(label => label.startsWith('type:'));
	const area = issue.labels.filter(label => label.startsWith('area:'));
	const priority = issue.labels.filter(label => label.startsWith('priority:'));
	const workflow = issue.labels.filter(label => label.startsWith('workflow:'));
	if (type.length !== 1) {
		findings.push(issueFinding('TYPE_LABEL_CARDINALITY', issue.number, `Expected exactly one type:* label, found ${type.length}`));
	}
	if (priority.length > 1) {
		findings.push(issueFinding('PRIORITY_LABEL_CARDINALITY', issue.number, `Expected at most one priority:* label, found ${priority.length}`));
	}
	for (const [prefix, labels, allowed] of [
		['type', type, typeLabels],
		['area', area, areaLabels],
		['priority', priority, priorityLabels],
		['workflow', workflow, workflowLabels],
	]) {
		for (const label of labels) {
			if (!allowed.has(label)) findings.push(issueFinding('UNKNOWN_TAXONOMY_LABEL', issue.number, `Unknown ${prefix} taxonomy label: ${label}`));
		}
	}
}

function issueFinding(code, issueNumber, message) {
	return { code, subject: 'issue', number: issueNumber, message };
}

function compareFindings(left, right) {
	if (left.number !== right.number) return left.number - right.number;
	const codeOrder = compareStableStrings(left.code, right.code);
	return codeOrder !== 0 ? codeOrder : compareStableStrings(left.message, right.message);
}

function validateSnapshot(snapshot) {
	if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) throw new Error('snapshot must be an object');
	if (snapshot.schemaVersion !== 1) throw new Error('snapshot.schemaVersion must be 1');
	if (typeof snapshot.repository !== 'string' || !/^[^/\s]+\/[^/\s]+$/u.test(snapshot.repository)) {
		throw new Error('snapshot.repository must use owner/name form');
	}
	if (!Array.isArray(snapshot.issues)) throw new Error('snapshot.issues must be an array');
	if (!Array.isArray(snapshot.pullRequests)) throw new Error('snapshot.pullRequests must be an array');
	const issueNumbers = new Set();
	for (const [index, issue] of snapshot.issues.entries()) {
		validateNormalizedIssue(issue, `snapshot.issues[${index}]`);
		if (issueNumbers.has(issue.number)) throw new Error(`snapshot.issues duplicates issue number ${issue.number}`);
		issueNumbers.add(issue.number);
	}
	const pullRequestNumbers = new Set();
	for (const [index, pullRequest] of snapshot.pullRequests.entries()) {
		validateNormalizedPullRequest(pullRequest, `snapshot.pullRequests[${index}]`);
		if (pullRequestNumbers.has(pullRequest.number)) throw new Error(`snapshot.pullRequests duplicates PR number ${pullRequest.number}`);
		pullRequestNumbers.add(pullRequest.number);
	}
}

function validateNormalizedIssue(issue, path) {
	if (!issue || typeof issue !== 'object' || Array.isArray(issue)) throw new Error(`${path} must be an object`);
	requirePositiveInteger(issue.number, `${path}.number`);
	requireOpenState(issue.state, `${path}.state`);
	if (typeof issue.body !== 'string') throw new Error(`${path}.body must be a string`);
	validateSortedUniqueStringArray(issue.assignees, `${path}.assignees`);
	validateSortedUniqueStringArray(issue.labels, `${path}.labels`);
}

function validateNormalizedPullRequest(pullRequest, path) {
	if (!pullRequest || typeof pullRequest !== 'object' || Array.isArray(pullRequest)) throw new Error(`${path} must be an object`);
	requirePositiveInteger(pullRequest.number, `${path}.number`);
	requireOpenState(pullRequest.state, `${path}.state`);
	requireBoolean(pullRequest.draft, `${path}.draft`);
	if (typeof pullRequest.body !== 'string') throw new Error(`${path}.body must be a string`);
}

function validateSortedUniqueStringArray(values, path) {
	if (!Array.isArray(values)) throw new Error(`${path} must be an array`);
	for (const [index, value] of values.entries()) {
		if (typeof value !== 'string' || value === '') throw new Error(`${path}[${index}] must be a non-empty string`);
		if (index > 0 && compareStableStrings(values[index - 1], value) >= 0) throw new Error(`${path} must be sorted and unique`);
	}
}

function compareStableStrings(left, right) {
	return left < right ? -1 : left > right ? 1 : 0;
}

function parseArguments(arguments_) {
	const options = { input: null, output: null, repository: process.env.GITHUB_REPOSITORY ?? null };
	for (let index = 0; index < arguments_.length; index += 1) {
		const argument = arguments_[index];
		if (argument === '--input') options.input = arguments_[++index] ?? null;
		else if (argument === '--output') options.output = arguments_[++index] ?? null;
		else if (argument === '--repository') options.repository = arguments_[++index] ?? null;
		else throw new Error(`Unknown argument: ${argument}`);
	}
	return options;
}

async function runCli() {
	const options = parseArguments(process.argv.slice(2));
	let snapshot;
	if (options.input !== null) {
		const raw = await readFile(resolve(repositoryRoot, options.input), 'utf8');
		snapshot = JSON.parse(raw);
	} else {
		snapshot = await collectGitHubWorkItems({
			repository: options.repository,
			token: process.env.GITHUB_TOKEN ?? '',
		});
	}
	const report = auditWorkItemMetadata(snapshot);
	const serialized = `${JSON.stringify(report, null, '\t')}\n`;
	if (options.output !== null) await writeFile(resolve(repositoryRoot, options.output), serialized, 'utf8');
	process.stdout.write(serialized);
	if (process.env.GITHUB_STEP_SUMMARY) {
		const lines = [
			'## Virune work-item metadata audit',
			'',
			`Open Issues: ${report.openIssueCount}`,
			`Open PRs: ${report.openPullRequestCount}`,
			`Active Implementation Issues: ${report.activeImplementationIssues.length}`,
			`Findings: ${report.findingCount}`,
			'',
			...report.findings.map(finding => `- ${finding.code}: #${finding.number} — ${finding.message}`),
			'',
		];
		await writeFile(process.env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`, { flag: 'a' });
	}
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) await runCli();
