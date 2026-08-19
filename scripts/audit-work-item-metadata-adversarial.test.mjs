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

test('multiline inline-code spans cannot activate or hide plain linkage', () => {
	assert.deepEqual(extractPlainIssueRefs('`example\nRefs #42\n`\nRefs #43\n'), [43]);
	assert.deepEqual(extractPlainIssueRefs('`example\nfoo <!--\n`\nRefs #44\n'), [44]);
	assert.deepEqual(extractPlainIssueRefs('`unclosed\nRefs #45\n'), [45]);
	assert.deepEqual(extractPlainIssueRefs('`unclosed\n- Refs #46\n`\n'), [46]);
	assert.deepEqual(extractPlainIssueRefs('`example\nfoo` <!--\nRefs #47\n'), []);
	assert.deepEqual(extractPlainIssueRefs('`unclosed\n# heading\nRefs #48\n`\n'), [48]);
	assert.deepEqual(extractPlainIssueRefs('`unclosed\n>quote\nRefs #49\n`\n'), [49]);
	assert.deepEqual(extractPlainIssueRefs('`unclosed\n1. list\nRefs #50\n`\n'), [50]);
	assert.deepEqual(extractPlainIssueRefs('`unclosed\n===\nRefs #51\n`\n'), [51]);
	assert.deepEqual(extractPlainIssueRefs('`unclosed\n<div>\nRefs #52\n`\n'), [52]);
	assert.deepEqual(extractPlainIssueRefs('`unclosed\n<?processing\nRefs #53\n`\n'), [53]);
	assert.deepEqual(extractPlainIssueRefs('`example\n<span>\nRefs #54\n`\nRefs #55\n'), [55]);
	assert.deepEqual(extractPlainIssueRefs('<script>\nconst template = `\n</script>\nRefs #56\n`\n'), [56]);
	assert.deepEqual(extractPlainIssueRefs('<div>\n`raw html\n</div>\n\nRefs #57\n`\n'), [57]);
});

test('raw HTML blocks do not supply role headings or plain linkage', () => {
	assert.deepEqual(
		parseWorkItemRole('<script>\n## Work item role\nImplementation\n</script>\n'),
		{ status: 'absent', role: null },
	);
	assert.deepEqual(extractPlainIssueRefs('<div>\nRefs #58\n</div>\n\nRefs #59\n'), [59]);
	assert.deepEqual(extractPlainIssueRefs('<source>\nRefs #60\n\nRefs #61\n'), [61]);
	assert.deepEqual(extractPlainIssueRefs('<?processing\nRefs #62\n?>\nRefs #63\n'), [63]);
});

test('fenced code takes precedence over raw HTML block markers', () => {
	assert.deepEqual(extractPlainIssueRefs('```html\n<div>\n```\nRefs #64\n'), [64]);
	assert.deepEqual(
		parseWorkItemRole('```html\n<script>\n```\n## Work item role\nImplementation\n'),
		{ status: 'valid', role: 'Implementation' },
	);
});

test('HTML comments take precedence over raw HTML block markers', () => {
	assert.deepEqual(extractPlainIssueRefs('<!--\n<div>\n-->\nRefs #65\n'), [65]);
	assert.deepEqual(
		parseWorkItemRole('<!--\n<script>\n-->\n## Work item role\nTracking\n'),
		{ status: 'valid', role: 'Tracking' },
	);
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
