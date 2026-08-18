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
