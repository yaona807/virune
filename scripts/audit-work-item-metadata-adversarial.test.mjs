import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	collectGitHubWorkItems,
	extractPlainIssueRefs,
	parseWorkItemRole,
} from './audit-work-item-metadata.mjs';

test('tab-indented Setext-looking text is treated as code, not a role heading', () => {
	for (const prefix of ['\t', ' \t', '  \t', '   \t']) {
		assert.deepEqual(
			parseWorkItemRole(`${prefix}Work item role\n----------------\nImplementation\n`),
			{ status: 'absent', role: null },
		);
	}
});

test('case-drifted role headings are invalid instead of escaping the audit', () => {
	assert.deepEqual(
		parseWorkItemRole('## Work Item Role\n\nImplementation\n'),
		{ status: 'invalid', role: null },
	);
	assert.deepEqual(
		parseWorkItemRole('## Work item role\n\nImplementation\n\n## WORK ITEM ROLE\n\nTracking\n'),
		{ status: 'invalid', role: null },
	);
});

test('indented-code HTML comment markers do not hide later visible metadata', () => {
	assert.deepEqual(
		parseWorkItemRole('    <!--\n## Work item role\n\nImplementation\n'),
		{ status: 'valid', role: 'Implementation' },
	);
	assert.deepEqual(extractPlainIssueRefs('    <!--\nRefs #42\n'), [42]);
});

test('invalid backtick-fence info does not hide real role metadata or linkage', () => {
	assert.deepEqual(
		parseWorkItemRole('```bad`info\n## Work item role\nImplementation\n'),
		{ status: 'valid', role: 'Implementation' },
	);
	assert.deepEqual(extractPlainIssueRefs('```bad`info\nRefs #42\n'), [42]);
});

test('provider collection rejects malformed Pulls API items explicitly', async () => {
	const fetchImpl = async url => ({
		ok: true,
		status: 200,
		json: async () => url.includes('/pulls?') ? [null] : [],
	});
	await assert.rejects(
		collectGitHubWorkItems({ repository: 'yaona807/virune', token: 'token', fetchImpl }),
		/GitHub Pulls response\[0\] must be an object/u,
	);
});
