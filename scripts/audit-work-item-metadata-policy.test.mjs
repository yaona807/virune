import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const expected = {
	type: ['type:bug', 'type:chore', 'type:ci', 'type:docs', 'type:feature', 'type:refactor', 'type:security', 'type:test'],
	area: ['area:cli', 'area:compiler', 'area:dx', 'area:governance', 'area:interop', 'area:release', 'area:runtime', 'area:selfhost', 'area:stdlib'],
	priority: ['priority:p0', 'priority:p1', 'priority:p2', 'priority:p3'],
	workflow: ['workflow:blocked', 'workflow:superseded', 'workflow:validation-only'],
};

function sectionBetween(source, startHeading, endHeading) {
	const normalized = source.replace(/\r\n?/gu, '\n');
	const start = normalized.indexOf(`${startHeading}\n`);
	assert.notEqual(start, -1, `${startHeading} section is missing`);
	const remainder = normalized.slice(start + `${startHeading}\n`.length);
	const end = remainder.indexOf(`\n${endHeading}\n`);
	assert.notEqual(end, -1, `${endHeading} boundary is missing`);
	return remainder.slice(0, end);
}

function taxonomySection(source) {
	return sectionBetween(source, '### Label taxonomy', '## Branch and Pull Request workflow');
}

function issuePolicySection(source) {
	return sectionBetween(source, '## Issue', '## Branch and Pull Request workflow');
}

function extractTaxonomy(source) {
	const section = taxonomySection(source);
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

function extractRoleContract(section) {
	const line = section.split('\n').find(value => value.includes('`Work item role`'));
	assert.ok(line, 'Work item role contract line is missing');
	return [...line.matchAll(/`([^`]+)`/gu)].map(match => match[1]);
}

for (const file of ['CONTRIBUTING.md', 'CONTRIBUTING_ja.md']) {
	test(`${file} label taxonomy matches the repository metadata audit contract`, async () => {
		const source = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
		assert.deepEqual(extractTaxonomy(source), expected);
	});

	test(`${file} work-item role and linkage policy matches the metadata audit contract`, async () => {
		const source = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
		const section = issuePolicySection(source);
		assert.deepEqual(extractRoleContract(section), ['Work item role', 'Implementation', 'Tracking']);
		assert.match(section, /`Refs #<issue-number>`/u);
	});
}
