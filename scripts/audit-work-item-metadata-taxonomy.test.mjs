import assert from 'node:assert/strict';
import { test } from 'node:test';
import { auditWorkItemMetadata } from './audit-work-item-metadata.mjs';

test('taxonomy prefix case drift is audited instead of escaping the governed namespace', () => {
	const report = auditWorkItemMetadata({
		schemaVersion: 1,
		repository: 'yaona807/virune',
		issues: [{
			number: 10,
			state: 'open',
			body: '## Work item role\n\nTracking\n',
			assignees: [],
			labels: ['Area:compiler', 'Priority:p1', 'Type:bug', 'Workflow:blocked'],
		}],
		pullRequests: [],
	});
	assert.deepEqual(report.findings, [
		{ code: 'UNKNOWN_TAXONOMY_LABEL', subject: 'issue', number: 10, message: 'Unknown area taxonomy label: Area:compiler' },
		{ code: 'UNKNOWN_TAXONOMY_LABEL', subject: 'issue', number: 10, message: 'Unknown priority taxonomy label: Priority:p1' },
		{ code: 'UNKNOWN_TAXONOMY_LABEL', subject: 'issue', number: 10, message: 'Unknown type taxonomy label: Type:bug' },
		{ code: 'UNKNOWN_TAXONOMY_LABEL', subject: 'issue', number: 10, message: 'Unknown workflow taxonomy label: Workflow:blocked' },
	]);
});
