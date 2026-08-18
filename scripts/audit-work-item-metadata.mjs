import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryOwner = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/u;
const repositoryName = /^[A-Za-z0-9._-]{1,100}$/u;
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
const roleHeadingIdentity = roleHeading.toLowerCase();
const validRoles = new Set(['Implementation', 'Tracking']);

function requireRepository(value, path) {
	if (typeof value !== 'string') throw new Error(`${path} must use owner/name form`);
	const parts = value.split('/');
	if (
		parts.length !== 2
		|| !repositoryOwner.test(parts[0])
		|| !repositoryName.test(parts[1])
		|| parts[1] === '.'
		|| parts[1] === '..'
	) {
		throw new Error(`${path} must use owner/name form`);
	}
	return value;
}

function requireProviderObject(value, path) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${path} must be an object`);
	return value;
}

export async function collectGitHubWorkItems({ repository, token, fetchImpl = fetch }) {
	const validatedRepository = requireRepository(repository, 'repository');
	if (typeof token !== 'string' || token === '') throw new Error('GitHub token is required');
	const headers = {
		accept: 'application/vnd.github+json',
		authorization: `Bearer ${token}`,
		'x-github-api-version': '2022-11-28',
	};
	const [owner, name] = validatedRepository.split('/');
	const apiRepository = `${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
	const issuesRaw = await fetchAllPages(`https://api.github.com/repos/${apiRepository}/issues?state=open&per_page=100`, headers, fetchImpl);
	const pullsRaw = await fetchAllPages(`https://api.github.com/repos/${apiRepository}/pulls?state=open&per_page=100`, headers, fetchImpl);
	const issues = issuesRaw
		.filter((issue, index) => !isIssuesEndpointPullRequest(issue, index))
		.map(issue => normalizeIssue(issue))
		.sort((left, right) => left.number - right.number);
	const pullRequests = pullsRaw
		.map((pullRequest, index) => normalizePullRequest(pullRequest, `GitHub Pulls response[${index}]`))
		.sort((left, right) => left.number - right.number);
	const snapshot = { schemaVersion: 1, repository: validatedRepository, issues, pullRequests };
	validateSnapshot(snapshot);
	return snapshot;
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

function isIssuesEndpointPullRequest(issue, index) {
	const path = `GitHub Issues response[${index}]`;
	requireProviderObject(issue, path);
	if (!Object.hasOwn(issue, 'pull_request')) return false;
	requirePositiveInteger(issue.number, `${path}.number`);
	requireOpenState(issue.state, `${path}.state`);
	if (!issue.pull_request || typeof issue.pull_request !== 'object' || Array.isArray(issue.pull_request)) {
		throw new Error(`${path}.pull_request must be an object`);
	}
	return true;
}

function normalizeIssue(issue) {
	requireProviderObject(issue, 'issue');
	return {
		number: requirePositiveInteger(issue.number, 'issue.number'),
		state: requireOpenState(issue.state, 'issue.state'),
		body: normalizeNullableString(issue.body, 'issue.body'),
		assignees: normalizeNames(issue.assignees, 'login', 'issue.assignees'),
		labels: normalizeNames(issue.labels, 'name', 'issue.labels'),
	};
}

function normalizePullRequest(pullRequest, path = 'pullRequest') {
	requireProviderObject(pullRequest, path);
	return {
		number: requirePositiveInteger(pullRequest.number, `${path}.number`),
		state: requireOpenState(pullRequest.state, `${path}.state`),
		draft: requireBoolean(pullRequest.draft, `${path}.draft`),
		body: normalizeNullableString(pullRequest.body, `${path}.body`),
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
		if (!value || typeof value !== 'object' || Array.isArray(value) || typeof value[key] !== 'string' || value[key] === '') {
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

function isEscaped(line, index) {
	let slashCount = 0;
	for (let cursor = index - 1; cursor >= 0 && line[cursor] === '\\'; cursor -= 1) slashCount += 1;
	return slashCount % 2 === 1;
}

function backtickRunLength(line, index) {
	let end = index;
	while (end < line.length && line[end] === '`') end += 1;
	return end - index;
}

function findClosingBacktickRun(line, start, expectedLength) {
	for (let cursor = start; cursor < line.length;) {
		const index = line.indexOf('`', cursor);
		if (index === -1) return -1;
		const length = backtickRunLength(line, index);
		if (length === expectedLength) return index;
		cursor = index + length;
	}
	return -1;
}

function findHtmlCommentStart(line, start) {
	for (let cursor = start; cursor < line.length;) {
		if (line.startsWith('<!--', cursor) && !isEscaped(line, cursor)) return cursor;
		if (line[cursor] === '`' && !isEscaped(line, cursor)) {
			const length = backtickRunLength(line, cursor);
			const closing = findClosingBacktickRun(line, cursor + length, length);
			if (closing !== -1) {
				cursor = closing + length;
				continue;
			}
			cursor += length;
			continue;
		}
		cursor += 1;
	}
	return -1;
}

function stripHtmlComments(line, commentState) {
	if (!commentState.open && /^(?: {4}| {0,3}\t)/u.test(line)) return line;
	let visible = '';
	let cursor = 0;
	while (cursor < line.length) {
		if (commentState.open) {
			const end = line.indexOf('-->', cursor);
			if (end === -1) return visible;
			commentState.open = false;
			cursor = end + 3;
			continue;
		}
		const start = findHtmlCommentStart(line, cursor);
		if (start === -1) {
			visible += line.slice(cursor);
			break;
		}
		visible += line.slice(cursor, start);
		const end = line.indexOf('-->', start + 4);
		if (end === -1) {
			commentState.open = true;
			break;
		}
		cursor = end + 3;
	}
	return visible;
}

function markdownLinesOutsideHiddenRegions(body) {
	const lines = body.replace(/\r\n?/gu, '\n').split('\n');
	const output = [];
	let fence = null;
	const commentState = { open: false };
	for (const rawLine of lines) {
		if (fence !== null) {
			const closing = rawLine.match(/^ {0,3}(`+|~+)[ \t]*$/u);
			if (closing !== null && closing[1][0] === fence.character && closing[1].length >= fence.length) fence = null;
			output.push(null);
			continue;
		}
		const visibleLine = stripHtmlComments(rawLine, commentState);
		const opening = visibleLine.match(/^ {0,3}(`{3,}|~{3,})(.*)$/u);
		if (opening !== null && !(opening[1][0] === '`' && opening[2].includes('`'))) {
			fence = { character: opening[1][0], length: opening[1].length };
			output.push(null);
			continue;
		}
		output.push(visibleLine);
	}
	return output;
}

function parseMarkdownHeading(lines, index) {
	const line = lines[index];
	if (line === null || line === undefined) return null;
	const atx = line.match(/^ {0,3}(#{1,6})(?:[ \t]+|$)(.*)$/u);
	if (atx !== null) {
		return {
			level: atx[1].length,
			text: atx[2].replace(/[ \t]+#+[ \t]*$/u, '').trim(),
			endIndex: index,
		};
	}
	const underline = lines[index + 1];
	if (
		line.trim() === ''
		|| /^(?: {4}| {0,3}\t)/u.test(line)
		|| underline === null
		|| underline === undefined
	) return null;
	const setext = underline.match(/^ {0,3}(=+|-+)[ \t]*$/u);
	if (setext === null) return null;
	return {
		level: setext[1][0] === '=' ? 1 : 2,
		text: line.trim(),
		endIndex: index + 1,
	};
}

export function parseWorkItemRole(body) {
	if (typeof body !== 'string') throw new Error('body must be a string');
	const lines = markdownLinesOutsideHiddenRegions(body);
	const headings = [];
	for (let index = 0; index < lines.length; index += 1) {
		const heading = parseMarkdownHeading(lines, index);
		if (heading === null) continue;
		if (heading.text.toLowerCase() === roleHeadingIdentity) {
			headings.push({ index, canonical: heading.text === roleHeading, ...heading });
		}
		index = heading.endIndex;
	}
	if (headings.length === 0) return { status: 'absent', role: null };
	if (headings.length !== 1 || !headings[0].canonical) return { status: 'invalid', role: null };
	const role = headings[0];
	const start = role.endIndex + 1;
	let end = lines.length;
	for (let index = start; index < lines.length; index += 1) {
		const heading = parseMarkdownHeading(lines, index);
		if (heading !== null && heading.level <= role.level) {
			end = index;
			break;
		}
		if (heading !== null) index = heading.endIndex;
	}
	const values = lines
		.slice(start, end)
		.filter(line => line !== null)
		.map(line => line.trim())
		.filter(Boolean);
	if (values.length !== 1 || !validRoles.has(values[0])) return { status: 'invalid', role: null };
	return { status: 'valid', role: values[0] };
}

export function extractPlainIssueRefs(body) {
	if (typeof body !== 'string') throw new Error('body must be a string');
	const numbers = new Set();
	const expression = /^ {0,3}(?:(?:[-+*]|[0-9]{1,9}[.)])[ \t]+)?Refs[ \t]+#([1-9][0-9]*)[ \t]*$/u;
	for (const line of markdownLinesOutsideHiddenRegions(body)) {
		if (line === null) continue;
		const match = line.match(expression);
		if (match === null) continue;
		const number = Number(match[1]);
		if (Number.isSafeInteger(number)) numbers.add(number);
	}
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
		auditTaxonomy(issue, findings);
		if (role.status === 'invalid') {
			findings.push(issueFinding('WORK_ITEM_ROLE_INVALID', issue.number, 'Work item role section must contain exactly one value: Implementation or Tracking'));
			continue;
		}
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

function labelsWithPrefix(labels, prefix) {
	const normalizedPrefix = `${prefix}:`;
	return labels.filter(label => label.slice(0, normalizedPrefix.length).toLowerCase() === normalizedPrefix);
}

function auditTaxonomy(issue, findings) {
	const type = labelsWithPrefix(issue.labels, 'type');
	const area = labelsWithPrefix(issue.labels, 'area');
	const priority = labelsWithPrefix(issue.labels, 'priority');
	const workflow = labelsWithPrefix(issue.labels, 'workflow');
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
	requireRepository(snapshot.repository, 'snapshot.repository');
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
		if (issueNumbers.has(pullRequest.number)) throw new Error(`snapshot Issue/PR number overlap ${pullRequest.number}`);
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

function requireArgumentValue(arguments_, index, name) {
	const value = arguments_[index + 1];
	if (typeof value !== 'string' || value === '' || value.startsWith('--')) throw new Error(`${name} requires a value`);
	return value;
}

function parseArguments(arguments_) {
	const options = { repository: process.env.GITHUB_REPOSITORY ?? null };
	for (let index = 0; index < arguments_.length; index += 1) {
		const argument = arguments_[index];
		if (argument === '--repository') {
			options.repository = requireArgumentValue(arguments_, index, '--repository');
			index += 1;
		} else {
			throw new Error(`Unknown argument: ${argument}`);
		}
	}
	return options;
}

async function runCli() {
	const options = parseArguments(process.argv.slice(2));
	const snapshot = await collectGitHubWorkItems({
		repository: options.repository,
		token: process.env.GITHUB_TOKEN ?? '',
	});
	const report = auditWorkItemMetadata(snapshot);
	const serialized = `${JSON.stringify(report, null, '\t')}\n`;
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
