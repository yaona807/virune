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

test('parses nested mappings, sequences, quoted scalars, booleans, and literal block scalars', () => {
	const parsed = parseYamlSubset(validBugForm);
	assert.equal(parsed.name, 'Bug report');
	assert.equal(parsed.title, 'bug: ');
	assert.equal(parsed.body[0].attributes.options[1], 'Tracking');
	assert.equal(parsed.body[0].validations.required, true);
	const contact = parseYamlSubset(validContactForm);
	assert.equal(contact.body[0].attributes.value, 'This issue is public.\nDo not include sensitive details.\n');
	const quoted = parseYamlSubset("value: 'here''s to quotes'\n");
	assert.equal(quoted.value, "here's to quotes");
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

test('validates additional yaml files instead of silently ignoring them', async t => {
	const root = await createTemplateRoot(t, canonicalFiles({
		'extra.yaml': `name: Extra\ndescription: Extra form\nbody:\n  - type: upload\n    id: evidence\n    attributes:\n      label: Evidence\n`,
	}));
	assert.deepEqual(await verifyIssueForms(root), [
		'extra.yaml: body[0].type must be one of markdown, input, textarea, dropdown, checkboxes',
	]);
});

test('requires Issue Form names longer than three characters', () => {
	const errors = validateIssueTemplateFile('bug_report.yml', `name: Bug\ndescription: Test\nbody:\n  - type: markdown\n    attributes:\n      value: Test\n`);
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

test('fails deterministically on malformed indentation', () => {
	assert.deepEqual(
		validateIssueTemplateFile('bug_report.yml', `name: Bug\ndescription: Broken\n body:\n  - type: markdown\n`),
		['bug_report.yml: YAML subset error at line 3: unexpected indentation 1; expected 0'],
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
	const errors = validateIssueTemplateFile('bug_report.yml', `name: Bugs\ndescription: Test\nunknown: value\nbody:\n  - type: markdown\n    extra: value\n    attributes:\n      value: Test\n`);
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
	const errors = validateIssueTemplateFile('bug_report.yml', `name: Bugs\ndescription: Test\nbody:\n  - type: markdown\n    id: notice\n    attributes:\n      value: Test\n    validations:\n      required: true\n`);
	assert.deepEqual(errors, [
		'bug_report.yml: body[0]: markdown entries must not define id',
		'bug_report.yml: body[0]: markdown entries must not define validations',
	]);
});

test('requires a non-empty dropdown option sequence', () => {
	const errors = validateIssueTemplateFile('change_proposal.yml', `name: Change\ndescription: Test\nbody:\n  - type: dropdown\n    id: role\n    attributes:\n      label: Role\n      options:\n`);
	assert.deepEqual(errors, ['change_proposal.yml: body[0].attributes.options must be a non-empty sequence of strings']);
});

test('validates checkbox option shape', () => {
	const errors = validateIssueTemplateFile('bug_report.yml', `name: Bugs\ndescription: Test\nbody:\n  - type: checkboxes\n    id: checks\n    attributes:\n      label: Checks\n      options:\n        - label: First\n          required: yes\n        - wrong: Second\n`);
	assert.deepEqual(errors, [
		'bug_report.yml: body[0].attributes.options[0].required must be a boolean',
		'bug_report.yml: body[0].attributes.options[1].label must be a non-empty string',
		'bug_report.yml: body[0].attributes.options[1]: unsupported key wrong',
	]);
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
