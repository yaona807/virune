import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { auditWorkItemMetadata } from './audit-work-item-metadata.mjs';

const expected = {
	type: ['type:bug', 'type:chore', 'type:ci', 'type:docs', 'type:feature', 'type:refactor', 'type:security', 'type:test'],
	area: ['area:cli', 'area:compiler', 'area:dx', 'area:governance', 'area:interop', 'area:release', 'area:runtime', 'area:selfhost', 'area:stdlib'],
	priority: ['priority:p0', 'priority:p1', 'priority:p2', 'priority:p3'],
	workflow: ['workflow:blocked', 'workflow:superseded', 'workflow:validation-only'],
};

const linkagePolicy = {
	'CONTRIBUTING.md': {
		plainRefs: /use plain `Refs #\.\.\.` references rather than `Closes`, `Fixes`, `Resolves`/u,
		implementation: /A normal implementation PR must reference an `Implementation` Issue/u,
	},
	'CONTRIBUTING_ja.md': {
		plainRefs: /`Closes`、`Fixes`、`Resolves`、GitHubのclosing relationshipではなくplainな`Refs #\.\.\.`を使用/u,
		implementation: /通常のimplementation PRは`Implementation` Issueを参照する必要があります/u,
	},
};

function sectionAtHeading(source, heading) {
	const normalized = source.replace(/\r\n?/gu, '\n');
	const headingExpression = /^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/gmu;
	let start = null;
	let level = null;
	for (const match of normalized.matchAll(headingExpression)) {
		if (match[2] !== heading) continue;
		assert.equal(start, null, `${heading} heading must be unique`);
		start = match.index + match[0].length;
		level = match[1].length;
	}
	assert.notEqual(start, null, `${heading} section is missing`);
	let end = normalized.length;
	headingExpression.lastIndex = start;
	for (const match of normalized.matchAll(headingExpression)) {
		if (match[1].length <= level) {
			end = match.index;
			break;
		}
	}
	return normalized.slice(start, end);
}

function extractTaxonomy(source) {
	const section = sectionAtHeading(source, 'Label taxonomy');
	const values = { type: new Set(), area: new Set(), priority: new Set(), workflow: new Set() };
	for (const match of section.matchAll(/`((type|area|priority|workflow):[A-Za-z0-9-]+)`/gu)) {
		values[match[2]].add(match[1]);
	}
	const priorityRange = /`priority:p([0-9]+)`\s*(?:through|から)\s*`priority:p([0-9]+)`/u.exec(section);
	if (priorityRange !== null) {
		const start = Number(priorityRange[1]);
		const end = Number(priorityRange[2]);
		assert.ok(Number.isSafeInteger(start) && Number.isSafeInteger(end) && start <= end, 'Priority range must be ascending safe integers');
		for (let value = start; value <= end; value += 1) values.priority.add(`priority:p${value}`);
	}
	return Object.fromEntries(
		Object.entries(values).map(([key, set]) => [key, [...set].sort()]),
	);
}

function extractRoleValues(section) {
	return [...section.matchAll(/^- `([^`]+)`\s+—/gmu)].map(match => match[1]);
}

function trackingIssue(number, labels) {
	return {
		number,
		state: 'open',
		body: '## Work item role\n\nTracking\n',
		assignees: [],
		labels: [...labels].sort(),
	};
}

test('every canonical taxonomy label is accepted by the audit implementation', () => {
	let number = 1;
	const issues = [];
	for (const label of expected.type) issues.push(trackingIssue(number++, [label]));
	for (const label of expected.area) issues.push(trackingIssue(number++, ['type:chore', label]));
	for (const label of expected.priority) issues.push(trackingIssue(number++, ['type:chore', label]));
	for (const label of expected.workflow) issues.push(trackingIssue(number++, ['type:chore', label]));
	const report = auditWorkItemMetadata({
		schemaVersion: 1,
		repository: 'yaona807/virune',
		issues,
		pullRequests: [],
	});
	assert.deepEqual(report.findings, []);
});

for (const file of ['CONTRIBUTING.md', 'CONTRIBUTING_ja.md']) {
	test(`${file} label taxonomy matches the repository metadata audit contract`, async () => {
		const source = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
		assert.deepEqual(extractTaxonomy(source), expected);
	});

	test(`${file} work-item role and linkage policy matches the repository metadata audit contract`, async () => {
		const source = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
		const section = sectionAtHeading(source, 'Work item role');
		assert.match(section, /`Work item role`/u);
		assert.deepEqual(extractRoleValues(section), ['Implementation', 'Tracking']);
		assert.match(section, linkagePolicy[file].plainRefs);
		assert.match(section, linkagePolicy[file].implementation);
	});
}
