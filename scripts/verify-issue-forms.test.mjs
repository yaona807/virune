import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { parseYamlSubset, validateIssueTemplateFile, verifyIssueForms } from './verify-issue-forms.mjs';

const validBugForm = `name: Bug report\ndescription: Report a defect\ntitle: "bug: "\nbody:\n  - type: dropdown\n    id: work_item_role\n    attributes:\n      label: Work item role\n      options:\n        - Implementation\n        - Tracking\n    validations:\n      required: true\n  - type: textarea\n    id: expected\n    attributes:\n      label: Expected behavior\n      description: What should happen?\n    validations:\n      required: true\n`;

const validContactForm = `name: Security contact request\ndescription: Request contact\ntitle: "security: request private contact"\nbody:\n  - type: markdown\n    attributes:\n      value: |\n        This issue is public.\n        Do not include sensitive details.\n  - type: checkboxes\n    id: confirmation\n    attributes:\n      label: Confirmation\n      options:\n        - label: I understand this is public.\n          required: true\n`;

const validConfig = `blank_issues_enabled: false\ncontact_links:\n  - name: Report a security vulnerability\n    url: https://github.com/example/project/security\n    about: Follow the private reporting policy.\n`;

test('current repository Issue Templates pass the validator', async () => {
	assert.deepEqual(await verifyIssueForms(), []);
});

test('accepts the supported Issue Form/config subset', () => {
	assert.deepEqual(validateIssueTemplateFile('bug_report.yml', validBugForm), []);
	assert.deepEqual(validateIssueTemplateFile('security_contact.yml', validContactForm), []);
	assert.deepEqual(validateIssueTemplateFile('config.yml', validConfig), []);
});

test('parses nested mappings, sequences, quoted scalars, GitHub boolean/null forms, and literal block scalars', () => {
	const parsed = parseYamlSubset(validBugForm);
	assert.equal(parsed.name, 'Bug report');
	assert.equal(parsed.title, 'bug: ');
	assert.equal(parsed.body[0].attributes.options[1], 'Tracking');
	assert.equal(parsed.body[0].validations.required, true);
	const contact = parseYamlSubset(validContactForm);
	assert.equal(contact.body[0].attributes.value, 'This issue is public.\nDo not include sensitive details.\n');
	const quoted = parseYamlSubset("value: 'here''s to quotes'\n");
	assert.equal(quoted.value, "here's to quotes");
	const githubScalars = parseYamlSubset('a: yes\nb: Y\nc: On\nd: No\ne: OFF\nf: TRUE\ng: NULL\n');
	assert.equal(githubScalars.a, true);
	assert.equal(githubScalars.b, true);
	assert.equal(githubScalars.c, true);
	assert.equal(githubScalars.d, false);
	assert.equal(githubScalars.e, false);
	assert.equal(githubScalars.f, true);
	assert.equal(githubScalars.g, null);
});

test('fails deterministically when the Issue Template directory is missing', async t => {
	const root = await mkdtemp(join(tmpdir(), 'virune-issue-forms-missing-'));
	t.after(async () => rm(root, { recursive: true, force: true }));
	assert.deepEqual(await verifyIssueForms(root), [
		'.github/ISSUE_TEMPLATE: required Issue Template directory is missing',
	]);
});

test('requires the Issue Template root path to be a real directory', async t => {
	const root = await mkdtemp(join(tmpdir(), 'virune-issue-forms-root-'));
	t.after(async () => rm(root, { recursive: true, force: true }));
	await mkdir(join(root, '.github'), { recursive: true });
	await writeFile(join(root, '.github', 'ISSUE_TEMPLATE'), 'not a directory', 'utf8');
	assert.deepEqual(await verifyIssueForms(root), [
		'.github/ISSUE_TEMPLATE: Issue Template path must be a real directory',
	]);
});

test('requires every canonical Issue Template/config file', async t => {
	const root = await createTemplateRoot(t, { 'config.yml': validConfig });
	assert.deepEqual(await verifyIssueForms(root), [
		'bug_report.yml: required canonical Issue Template file is missing',
		'change_proposal.yml: required canonical Issue Template file is missing',
		'conduct_contact.yml: required canonical Issue Template file is missing',
		'security_contact.yml: required canonical Issue Template file is missing',
	]);
});

test('rejects Issue Template paths that are not regular files', async t => {
	const root = await createTemplateRoot(t, canonicalFiles());
	await mkdir(join(root, '.github', 'ISSUE_TEMPLATE', 'extra.yml'));
	assert.deepEqual(await verifyIssueForms(root), [
		'extra.yml: Issue Template entry must be a regular file',
	]);
});

test('rejects unsupported .yaml Issue Form filenames', async t => {
	const root = await createTemplateRoot(t, canonicalFiles({
		'extra.yaml': `name: Extra\ndescription: Extra form\nbody:\n  - type: input\n    id: evidence\n    attributes:\n      label: Evidence\n`,
	}));
	assert.deepEqual(await verifyIssueForms(root), [
		'extra.yaml: GitHub Issue Forms require the .yml extension; .yaml is unsupported',
	]);
});

test('validates case-insensitive .YML Issue Form filenames instead of ignoring them', async t => {
	const root = await createTemplateRoot(t, canonicalFiles({
		'extra.YML': `name: Extra\ndescription: Extra form\nbody:\n  - type: upload\n    id: evidence\n    attributes:\n      label: Evidence\n`,
	}));
	assert.deepEqual(await verifyIssueForms(root), [
		'extra.YML: body[0].type must be one of markdown, input, textarea, dropdown, checkboxes',
	]);
});

test('rejects case-insensitive Issue Template filename collisions', async t => {
	const root = await createTemplateRoot(t, canonicalFiles({
		'BUG_REPORT.YML': `name: Upper bug\ndescription: Extra form\nbody:\n  - type: input\n    id: evidence\n    attributes:\n      label: Evidence\n`,
	}));
	assert.deepEqual(await verifyIssueForms(root), [
		'bug_report.yml: template filename collides case-insensitively with BUG_REPORT.YML',
	]);
});

test('fails closed when a Markdown Issue Template is introduced outside the supported subset', async t => {
	const root = await createTemplateRoot(t, canonicalFiles({
		'legacy.md': '---\nname: Legacy template\n---\n',
	}));
	assert.deepEqual(await verifyIssueForms(root), [
		'legacy.md: Markdown Issue Templates are outside the supported repository subset; extend the validator before adding one',
	]);
});

test('requires Issue Form names longer than three characters', () => {
	const errors = validateIssueTemplateFile('bug_report.yml', `name: Bug\ndescription: Test\nbody:\n  - type: textarea\n    id: details\n    attributes:\n      label: Details\n`);
	assert.deepEqual(errors, ['bug_report.yml: name must be longer than 3 characters']);
});

test('rejects duplicate Issue Form names deterministically', async t => {
	const root = await createTemplateRoot(t, canonicalFiles({
		'extra.yml': validBugForm,
	}));
	assert.deepEqual(await verifyIssueForms(root), [
		'extra.yml: name duplicates bug_report.yml: Bug report',
	]);
});

test('rejects a markdown-only body', () => {
	const errors = validateIssueTemplateFile('bug_report.yml', `name: Bugs\ndescription: Test\nbody:\n  - type: markdown\n    attributes:\n      value: Static only\n`);
	assert.deepEqual(errors, ['bug_report.yml: body must contain at least one non-markdown field']);
});

test('fails deterministically on malformed indentation', () => {
	assert.deepEqual(
		validateIssueTemplateFile('bug_report.yml', `name: Bug\ndescription: Broken\n body:\n  - type: markdown\n`),
		['bug_report.yml: YAML subset error at line 3: unexpected indentation 1; expected 0'],
	);
});

test('rejects unsupported control characters', () => {
	assert.deepEqual(
		validateIssueTemplateFile('bug_report.yml', `name: Bugs\ndescription: bad\u0001value\nbody:\n  - type: textarea\n    id: details\n    attributes:\n      label: Details\n`),
		['bug_report.yml: YAML subset error at line 2: unsupported control character'],
	);
});

test('fails on duplicate mapping keys instead of accepting the last value', () => {
	assert.deepEqual(
		validateIssueTemplateFile('bug_report.yml', `name: Bug\nname: Other\ndescription: Duplicate\nbody:\n  - type: markdown\n    attributes:\n      value: Test\n`),
		['bug_report.yml: YAML subset error at line 2: duplicate key name'],
	);
});

test('fails closed on unsupported YAML constructs', () => {
	assert.deepEqual(
		validateIssueTemplateFile('bug_report.yml', `name: Bug\ndescription: Test\nbody: [one, two]\n`),
		['bug_report.yml: YAML subset error at line 3: flow-style collections are not supported'],
	);
	assert.deepEqual(
		validateIssueTemplateFile('bug_report.yml', `name: &name Bug\ndescription: Test\nbody:\n  - type: markdown\n    attributes:\n      value: Test\n`),
		['bug_report.yml: YAML subset error at line 1: anchors, aliases, and tags are not supported'],
	);
	assert.deepEqual(
		validateIssueTemplateFile('bug_report.yml', `name: Bug\ndescription: >\n  Folded text\nbody:\n  - type: markdown\n    attributes:\n      value: Test\n`),
		['bug_report.yml: YAML subset error at line 2: folded block scalars are not supported'],
	);
	assert.deepEqual(
		validateIssueTemplateFile('bug_report.yml', `name: Bug\ndescription: 'broken'quote'\nbody:\n  - type: markdown\n    attributes:\n      value: Test\n`),
		['bug_report.yml: YAML subset error at line 2: invalid single-quoted string'],
	);
});

test('does not guess ambiguous plain-scalar YAML semantics', () => {
	assert.deepEqual(
		validateIssueTemplateFile('bug_report.yml', `name: Bug\ndescription: foo: bar\nbody:\n  - type: markdown\n    attributes:\n      value: Test\n`),
		['bug_report.yml: YAML subset error at line 2: plain strings containing colon followed by whitespace are not supported'],
	);
	assert.deepEqual(
		validateIssueTemplateFile('bug_report.yml', `name: Bug\ndescription: 1.25\nbody:\n  - type: markdown\n    attributes:\n      value: Test\n`),
		['bug_report.yml: YAML subset error at line 2: non-integer numeric scalars are not supported'],
	);
});

test('rejects missing required top-level form fields', () => {
	assert.deepEqual(
		validateIssueTemplateFile('bug_report.yml', `name: Bugs\ndescription: Test\n`),
		['bug_report.yml: body must be a non-empty sequence'],
	);
});

test('rejects unsupported top-level and body-entry keys in deterministic order', () => {
	const errors = validateIssueTemplateFile('bug_report.yml', `name: Bugs\ndescription: Test\nunknown: value\nbody:\n  - type: textarea\n    id: details\n    extra: value\n    attributes:\n      label: Details\n`);
	assert.deepEqual(errors, [
		'bug_report.yml: body[0]: unsupported key extra',
		'bug_report.yml: unsupported key unknown',
	]);
});

test('rejects duplicate ids', () => {
	const errors = validateIssueTemplateFile('bug_report.yml', `name: Bugs\ndescription: Test\nbody:\n  - type: textarea\n    id: details\n    attributes:\n      label: Details\n  - type: input\n    id: details\n    attributes:\n      label: More details\n`);
	assert.deepEqual(errors, ['bug_report.yml: body[1].id duplicates details']);
});

test('rejects markdown id and validations fields', () => {
	const errors = validateIssueTemplateFile('bug_report.yml', `name: Bugs\ndescription: Test\nbody:\n  - type: markdown\n    id: notice\n    attributes:\n      value: Test\n    validations:\n      required: true\n  - type: input\n    id: details\n    attributes:\n      label: Details\n`);
	assert.deepEqual(errors, [
		'bug_report.yml: body[0]: markdown entries must not define id',
		'bug_report.yml: body[0]: markdown entries must not define validations',
	]);
});

test('requires a non-empty dropdown option sequence', () => {
	const errors = validateIssueTemplateFile('change_proposal.yml', `name: Change\ndescription: Test\nbody:\n  - type: dropdown\n    id: role\n    attributes:\n      label: Role\n      options:\n`);
	assert.deepEqual(errors, ['change_proposal.yml: body[0].attributes.options must be a non-empty sequence of strings']);
});

test('requires dropdown option choices to be distinct', () => {
	const errors = validateIssueTemplateFile('change_proposal.yml', `name: Change\ndescription: Test\nbody:\n  - type: dropdown\n    id: role\n    attributes:\n      label: Role\n      options:\n        - Implementation\n        - Implementation\n`);
	assert.deepEqual(errors, ['change_proposal.yml: body[0].attributes.options choices must be distinct']);
});

test('rejects the reserved dropdown choice None', () => {
	const errors = validateIssueTemplateFile('change_proposal.yml', `name: Change\ndescription: Test\nbody:\n  - type: dropdown\n    id: role\n    attributes:\n      label: Role\n      options:\n        - Implementation\n        - None\n`);
	assert.deepEqual(errors, ['change_proposal.yml: body[0].attributes.options must not include reserved choice None']);
});

test('rejects unquoted GitHub boolean words as dropdown options while quoted strings remain valid', () => {
	const invalid = validateIssueTemplateFile('change_proposal.yml', `name: Change\ndescription: Test\nbody:\n  - type: dropdown\n    id: answer\n    attributes:\n      label: Answer\n      options:\n        - Yes\n        - Maybe\n`);
	assert.deepEqual(invalid, ['change_proposal.yml: body[0].attributes.options must be a non-empty sequence of strings']);
	const valid = validateIssueTemplateFile('change_proposal.yml', `name: Change\ndescription: Test\nbody:\n  - type: dropdown\n    id: answer\n    attributes:\n      label: Answer\n      options:\n        - "Yes"\n        - Maybe\n`);
	assert.deepEqual(valid, []);
});

test('validates checkbox option shape', () => {
	const errors = validateIssueTemplateFile('bug_report.yml', `name: Bugs\ndescription: Test\nbody:\n  - type: checkboxes\n    id: checks\n    attributes:\n      label: Checks\n      options:\n        - label: First\n          required: maybe\n        - wrong: Second\n`);
	assert.deepEqual(errors, [
		'bug_report.yml: body[0].attributes.options[0].required must be a boolean',
		'bug_report.yml: body[0].attributes.options[1].label must be a non-empty string',
		'bug_report.yml: body[0].attributes.options[1]: unsupported key wrong',
	]);
});

test('requires checkbox option labels to be distinct', () => {
	const errors = validateIssueTemplateFile('bug_report.yml', `name: Bugs\ndescription: Test\nbody:\n  - type: checkboxes\n    id: checks\n    attributes:\n      label: Checks\n      options:\n        - label: Same\n        - label: Same\n`);
	assert.deepEqual(errors, ['bug_report.yml: body[0].attributes.options[1].label duplicates Same']);
});

test('forbids free-text input and selection fields in public contact-only forms', () => {
	assert.deepEqual(
		validateIssueTemplateFile('security_contact.yml', `name: Security contact\ndescription: Test\nbody:\n  - type: textarea\n    id: details\n    attributes:\n      label: Details\n`),
		['security_contact.yml: body[0].type textarea is forbidden in public contact-only forms'],
	);
	assert.deepEqual(
		validateIssueTemplateFile('conduct_contact.yml', `name: Conduct contact\ndescription: Test\nbody:\n  - type: input\n    id: contact\n    attributes:\n      label: Contact\n  - type: dropdown\n    id: category\n    attributes:\n      label: Category\n      options:\n        - Other\n`),
		[
			'conduct_contact.yml: body[0].type input is forbidden in public contact-only forms',
			'conduct_contact.yml: body[1].type dropdown is forbidden in public contact-only forms',
		],
	);
});

test('requires every contact-only checkbox acknowledgement explicitly', () => {
	const errors = validateIssueTemplateFile('security_contact.yml', `name: Security contact\ndescription: Test\nbody:\n  - type: checkboxes\n    id: confirmation\n    attributes:\n      label: Confirmation\n      options:\n        - label: Public\n          required: true\n        - label: No secrets\n`);
	assert.deepEqual(errors, ['security_contact.yml: body[0].attributes.options[1] must be explicitly required in public contact-only forms']);
});

test('validates config link structure without inventing an unrelated URL policy', () => {
	const errors = validateIssueTemplateFile('config.yml', `blank_issues_enabled: false\ncontact_links:\n  - name: Security\n    url: http://example.com/security\n`);
	assert.deepEqual(errors, ['config.yml: contact_links[0].about must be a non-empty string']);
});

async function createTemplateRoot(t, files) {
	const root = await mkdtemp(join(tmpdir(), 'virune-issue-forms-'));
	t.after(async () => rm(root, { recursive: true, force: true }));
	const directory = join(root, '.github', 'ISSUE_TEMPLATE');
	await mkdir(directory, { recursive: true });
	for (const [name, source] of Object.entries(files)) await writeFile(join(directory, name), source, 'utf8');
	return root;
}

function canonicalFiles(extra = {}) {
	return {
		'bug_report.yml': validBugForm,
		'change_proposal.yml': validBugForm.replace('Bug report', 'Change proposal'),
		'conduct_contact.yml': validContactForm.replaceAll('Security', 'Conduct'),
		'config.yml': validConfig,
		'security_contact.yml': validContactForm,
		...extra,
	};
}
