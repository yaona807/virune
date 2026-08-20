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
	assert.deepEqual(parseWorkItemRole('## Work Item Role\n\nImplementation\n'), { status: 'invalid', role: null });
	assert.deepEqual(
		parseWorkItemRole('## Work item role\n\nImplementation\n\n## WORK ITEM ROLE\n\nTracking\n'),
		{ status: 'invalid', role: null },
	);
});

test('indented-code HTML comment markers do not hide later visible metadata', () => {
	assert.deepEqual(parseWorkItemRole('    <!--\n## Work item role\n\nImplementation\n'), { status: 'valid', role: 'Implementation' });
	assert.deepEqual(extractPlainIssueRefs('    <!--\nRefs #42\n'), [42]);
});

test('indented code cannot seed multiline inline-code or comment state', () => {
	assert.deepEqual(extractPlainIssueRefs('    <!--\n`example\nRefs #66\n`\n'), []);
	assert.deepEqual(extractPlainIssueRefs('    `literal\nRefs #67\n`\n'), [67]);
});

test('indented paragraph continuations preserve inline HTML comment state', () => {
	assert.deepEqual(extractPlainIssueRefs('paragraph\n    <!--\nRefs #84\n-->\nRefs #85\n'), [85]);
	assert.deepEqual(extractPlainIssueRefs('Refs #86 <!--\n'), []);
	assert.deepEqual(extractPlainIssueRefs('Refs #86 <!--\n# heading\nRefs #87\n'), [87]);
	assert.deepEqual(parseWorkItemRole('paragraph\n    <!--\n## Work item role\nImplementation\n'), { status: 'valid', role: 'Implementation' });
});

test('empty list markers follow block interruption rules', () => {
	assert.deepEqual(extractPlainIssueRefs('`example\n+ \nRefs #88\n`\n'), []);
	assert.deepEqual(extractPlainIssueRefs('`example\n1. \nRefs #89\n`\n'), []);
	assert.deepEqual(extractPlainIssueRefs('paragraph <!--\n+ \nRefs #90\n-->\n'), []);
	assert.deepEqual(extractPlainIssueRefs('`example\n- \nRefs #91\n`\n'), [91]);
});

test('list-contained code examples cannot supply role headings or linkage', () => {
	assert.deepEqual(extractPlainIssueRefs('- ```md\n  Refs #92\n  ```\nRefs #93\n'), [93]);
	assert.deepEqual(
		parseWorkItemRole('- ```md\n  ## Work item role\n  Implementation\n  ```\n## Work item role\nImplementation\n'),
		{ status: 'valid', role: 'Implementation' },
	);
	assert.deepEqual(extractPlainIssueRefs('- <div>\n  Refs #94\n  </div>\n\nRefs #95\n'), [95]);
	assert.deepEqual(
		parseWorkItemRole('- <div>\n  ## Work item role\n  Implementation\n  </div>\n\n## Work item role\nTracking\n'),
		{ status: 'valid', role: 'Tracking' },
	);
});

test('list-contained fences obey actual list interruption and relative closing indent', () => {
	assert.deepEqual(extractPlainIssueRefs('paragraph\n2. ```md\nRefs #100\n'), [100]);
	assert.deepEqual(extractPlainIssueRefs('- ```md\n      ```\n  - Refs #101\n'), []);
	assert.deepEqual(
		parseWorkItemRole('- ```md\n      ```\n  ## Work item role\n  Implementation\n'),
		{ status: 'absent', role: null },
	);
	assert.deepEqual(extractPlainIssueRefs('- ```md\n     ```\nRefs #102\n'), [102]);
});

test('Setext completion reopens type-7 HTML block eligibility', () => {
	assert.deepEqual(extractPlainIssueRefs('paragraph\n-\n<span>\nRefs #103\n\nRefs #104\n'), [104]);
});

test('Setext headings are not plain linkage lines', () => {
	assert.deepEqual(extractPlainIssueRefs('Refs #105\n---\nRefs #106\n'), [106]);
	assert.deepEqual(extractPlainIssueRefs('intro\nRefs #107\n---\nRefs #108\n'), [108]);
});

test('plain linkage remains a source-line contract outside code', () => {
	assert.deepEqual(extractPlainIssueRefs('- prose\nRefs #96\n\nRefs #97\n'), [96, 97]);
	assert.deepEqual(extractPlainIssueRefs('  Refs #98\n'), []);
	assert.deepEqual(extractPlainIssueRefs('  - Refs #99\n'), [99]);
});

test('list-marker linkage rejects indented-code content while preserving ordinary list content', () => {
	assert.deepEqual(extractPlainIssueRefs('-    Refs #109\n'), [109]);
	assert.deepEqual(extractPlainIssueRefs('-     Refs #110\n'), []);
	assert.deepEqual(extractPlainIssueRefs('1.     Refs #111\n'), []);
	assert.deepEqual(extractPlainIssueRefs('-\tRefs #112\n'), [112]);
	assert.deepEqual(extractPlainIssueRefs('-\t\tRefs #113\n'), []);
});

test('list-marker linkage obeys paragraph interruption and source-line position', () => {
	assert.deepEqual(extractPlainIssueRefs('paragraph\n2. Refs #114\n'), []);
	assert.deepEqual(extractPlainIssueRefs('paragraph\n1. Refs #115\n'), [115]);
	assert.deepEqual(extractPlainIssueRefs('paragraph\n- Refs #116\n'), [116]);
	assert.deepEqual(extractPlainIssueRefs('paragraph\n\n2. Refs #117\n'), [117]);
	assert.deepEqual(extractPlainIssueRefs('<!-- note --> - Refs #118\n'), []);
	assert.deepEqual(extractPlainIssueRefs('- Refs #119\n---\n'), [119]);
});

test('HTML comments cannot transform source lines into plain linkage', () => {
	assert.deepEqual(extractPlainIssueRefs('- <!-- note --> Refs #120\n'), []);
	assert.deepEqual(extractPlainIssueRefs('Refs #121 <!-- note -->\n'), []);
	assert.deepEqual(extractPlainIssueRefs('- Refs #122 <!-- note -->\n'), []);
	assert.deepEqual(extractPlainIssueRefs('- Refs #123\n'), [123]);
});

test('GFM comments do not use browser-only --!> recovery as a terminator', () => {
	assert.deepEqual(
		extractPlainIssueRefs('<!--\nRefs #124\n--!>\nRefs #125\n-->\nRefs #126\n'),
		[126],
	);
	assert.deepEqual(
		extractPlainIssueRefs('paragraph <!--\n--!>\nRefs #127\n-->\nRefs #128\n'),
		[128],
	);
	assert.deepEqual(
		parseWorkItemRole('<!--\n## Work item role\nImplementation\n--!>\n## Work item role\nTracking\n-->\n## Work item role\nImplementation\n'),
		{ status: 'valid', role: 'Implementation' },
	);
});

test('GitHub cmark-gfm block tags distinguish source from search', () => {
	assert.deepEqual(extractPlainIssueRefs('intro\n<source>\nRefs #129\n\nRefs #130\n'), [130]);
	assert.deepEqual(extractPlainIssueRefs('intro\n<search>\nRefs #131\n\nRefs #132\n'), [131, 132]);
});

test('GitHub cmark-gfm short comment forms are block-only at line start, not inline comments', () => {
	assert.deepEqual(extractPlainIssueRefs('<!-->\nRefs #133\n'), [133]);
	assert.deepEqual(extractPlainIssueRefs('<!--->\nRefs #134\n'), [134]);
	assert.deepEqual(parseWorkItemRole('## Work item role <!-->\nImplementation\n'), { status: 'absent', role: null });
	assert.deepEqual(parseWorkItemRole('## Work item role <!--->\nTracking\n'), { status: 'absent', role: null });
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
	assert.deepEqual(extractPlainIssueRefs('`unclosed\n<div>\nRefs #52\n`\n'), []);
	assert.deepEqual(extractPlainIssueRefs('`unclosed\n<?processing\nRefs #53\n`\n'), []);
	assert.deepEqual(extractPlainIssueRefs('`example\n<span>\nRefs #54\n`\nRefs #55\n'), [55]);
	assert.deepEqual(extractPlainIssueRefs('<script>\nconst template = `\n</script>\nRefs #56\n`\n'), [56]);
	assert.deepEqual(extractPlainIssueRefs('<div>\n`raw html\n</div>\n\nRefs #57\n`\n'), [57]);
});

test('raw HTML blocks do not supply role headings or plain linkage', () => {
	assert.deepEqual(parseWorkItemRole('<script>\n## Work item role\nImplementation\n</script>\n'), { status: 'absent', role: null });
	assert.deepEqual(extractPlainIssueRefs('<div>\nRefs #58\n</div>\n\nRefs #59\n'), [59]);
	assert.deepEqual(extractPlainIssueRefs('<source>\nRefs #60\n\nRefs #61\n'), [61]);
	assert.deepEqual(extractPlainIssueRefs('<?processing\nRefs #62\n?>\nRefs #63\n'), [63]);
	assert.deepEqual(extractPlainIssueRefs('<script>\n</style>\nRefs #78\n</script>\nRefs #79\n'), [78, 79]);
});

test('type-7 HTML blocks only start at block boundaries', () => {
	assert.deepEqual(parseWorkItemRole('<widget data-kind="example">\n## Work item role\nImplementation\n\n'), { status: 'absent', role: null });
	assert.deepEqual(extractPlainIssueRefs('# heading\n<source>\nRefs #69\n\nRefs #70\n'), [70]);
	assert.deepEqual(extractPlainIssueRefs('<widget data-kind=example>\n`raw\nRefs #71\n\nRefs #72\n`\n'), [72]);
	assert.deepEqual(extractPlainIssueRefs('<widget data-kind=>\nRefs #73\n'), [73]);
	assert.deepEqual(extractPlainIssueRefs('</widget>\nRefs #74\n\nRefs #75\n'), [75]);
});

test('line-start HTML comment blocks close on the literal GFM block terminator', () => {
	assert.deepEqual(extractPlainIssueRefs('<!-->\nRefs #76\n'), [76]);
	assert.deepEqual(extractPlainIssueRefs('<!--->\nRefs #77\n'), [77]);
	assert.deepEqual(parseWorkItemRole('<!-->\n## Work item role\nImplementation\n'), { status: 'valid', role: 'Implementation' });
});

test('line-start HTML comment blocks hide their entire closing line', () => {
	assert.deepEqual(extractPlainIssueRefs('<!-- hidden --> Refs #80\nRefs #81\n'), [81]);
	assert.deepEqual(extractPlainIssueRefs('<!--\nhidden\n--> Refs #82\nRefs #83\n'), [83]);
	assert.deepEqual(parseWorkItemRole('<!-- hidden --> ## Work item role\nImplementation\n'), { status: 'absent', role: null });
});

test('multiline Setext headings cannot masquerade as exact role headings', () => {
	assert.deepEqual(parseWorkItemRole('intro\nWork item role\n---\nImplementation\n'), { status: 'absent', role: null });
	assert.deepEqual(parseWorkItemRole('## Work item role\nImplementation\n\nOther\ncontext\n---\nbody\n'), { status: 'valid', role: 'Implementation' });
});

test('fenced code takes precedence over raw HTML block markers', () => {
	assert.deepEqual(extractPlainIssueRefs('```html\n<div>\n```\nRefs #64\n'), [64]);
	assert.deepEqual(parseWorkItemRole('```html\n<script>\n```\n## Work item role\nImplementation\n'), { status: 'valid', role: 'Implementation' });
});

test('HTML comments take precedence over raw HTML block markers', () => {
	assert.deepEqual(extractPlainIssueRefs('<!--\n<div>\n-->\nRefs #65\n'), [65]);
	assert.deepEqual(parseWorkItemRole('<!--\n<script>\n-->\n## Work item role\nTracking\n'), { status: 'valid', role: 'Tracking' });
});

test('invalid backtick-fence info does not hide real role metadata or linkage', () => {
	assert.deepEqual(parseWorkItemRole('```bad`info\n## Work item role\nImplementation\n'), { status: 'valid', role: 'Implementation' });
	assert.deepEqual(extractPlainIssueRefs('```bad`info\nRefs #42\n'), [42]);
	assert.deepEqual(extractPlainIssueRefs('- ```bad`info\nRefs #43\n'), [43]);
});

test('provider collection rejects malformed Pulls API items explicitly', async () => {
	const fetchImpl = async url => ({ ok: true, status: 200, json: async () => url.includes('/pulls?') ? [null] : [] });
	await assert.rejects(
		collectGitHubWorkItems({ repository: 'yaona807/virune', token: 'token', fetchImpl }),
		/GitHub Pulls response\[0\] must be an object/u,
	);
});
