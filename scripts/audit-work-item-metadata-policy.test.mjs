import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const expected = {
	type: ['type:bug', 'type:chore', 'type:ci', 'type:docs', 'type:feature', 'type:refactor', 'type:security', 'type:test'],
	area: ['area:cli', 'area:compiler', 'area:dx', 'area:governance', 'area:interop', 'area:release', 'area:runtime', 'area:selfhost', 'area:stdlib'],
	priority: ['priority:p0', 'priority:p1', 'priority:p2', 'priority:p3'],
	workflow: ['workflow:blocked', 'workflow:superseded', 'workflow:validation-only'],
};

function taxonomySection(source) {
	const normalized = source.replace(/\r\n?/gu, '\n');
	const start = normalized.indexOf('### Label taxonomy\n');
	assert.notEqual(start, -1, 'Label taxonomy section is missing');
	const remainder = normalized.slice(start + '### Label taxonomy\n'.length);
	const end = remainder.search(/^## /mu);
	return end === -1 ? remainder : remainder.slice(0, end);
}

function extractTaxonomy(source) {
	const section = taxonomySection(source);
	const values = { type: new Set(), area: new Set(), priority: new Set(), workflow: new Set() };
	for (const match of section.matchAll(/`((type|area|priority|workflow):[A-Za-z0-9-]+)`/gu)) {
		values[match[2]].add(match[1]);
	}
	const priorities = [...values.priority]
		.map(label => /^priority:p([0-9]+)$/u.exec(label))
		.filter(Boolean)
		.map(match => Number(match[1]));
	if (priorities.length >= 2) {
		const minimum = Math.min(...priorities);
		const maximum = Math.max(...priorities);
		for (let value = minimum; value <= maximum; value += 1) values.priority.add(`priority:p${value}`);
	}
	return Object.fromEntries(
		Object.entries(values).map(([key, set]) => [key, [...set].sort()]),
	);
}

for (const file of ['CONTRIBUTING.md', 'CONTRIBUTING_ja.md']) {
	test(`${file} label taxonomy matches the repository metadata audit contract`, async () => {
		const source = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
		assert.deepEqual(extractTaxonomy(source), expected);
	});
}
