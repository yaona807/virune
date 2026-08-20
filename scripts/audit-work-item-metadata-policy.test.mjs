import assert from 'node:assert/strict';
import { test } from 'node:test';
import { auditWorkItemMetadata } from './audit-work-item-metadata.mjs';

const expected = {
	type: ['type:bug', 'type:chore', 'type:ci', 'type:docs', 'type:feature', 'type:refactor', 'type:security', 'type:test'],
	area: ['area:cli', 'area:compiler', 'area:dx', 'area:governance', 'area:interop', 'area:release', 'area:runtime', 'area:selfhost', 'area:stdlib'],
	priority: ['priority:p0', 'priority:p1', 'priority:p2', 'priority:p3'],
	workflow: ['workflow:blocked', 'workflow:superseded', 'workflow:validation-only'],
};

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
