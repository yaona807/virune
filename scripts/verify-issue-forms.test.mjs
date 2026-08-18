import assert from 'node:assert/strict';
import test from 'node:test';
import { parseYamlSubset, validateIssueTemplateFile } from './verify-issue-forms.mjs';

const validBugForm = `name: Bug report
description: Report a defect
title: "bug: "
body:
  - type: dropdown
    id: work_item_role
    attributes:
      label: Work item role
      options:
        - Implementation
        - Tracking
    validations:
      required: true
  - type: textarea
    id: expected
    attributes:
      label: Expected behavior
      description: What should happen?
    validations:
      required: true
  - type: checkboxes
    id: checks
    attributes:
      label: Checks
      options:
        - label: I checked duplicates.
          required: true
`;

const validContactForm = `name: Security contact request
description: Request contact
title: "security: request private contact"
body:
  - type: markdown
    attributes:
      value: |
        This issue is public.
        Do not include sensitive details.
  - type: checkboxes
    id: confirmation
    attributes:
      label: Confirmation
      options:
        - label: I understand this is public.
          required: true
`;

const validConfig = `blank_issues_enabled: false
contact_links:
  - name: Report a security vulnerability
    url: https://github.com/example/project/security
    about: Follow the private reporting policy.
`;

test('accepts the current Issue Form subset', () => {
	assert.deepEqual(validateIssueTemplateFile('bug_report.yml', validBugForm), []);
	assert.deepEqual(validateIssueTemplateFile('security_contact.yml', validContactForm), []);
	assert.deepEqual(validateIssueTemplateFile('config.yml', validConfig), []);
});

test('parses nested mappings, sequences, quoted scalars, booleans, and block scalars', () => {
	const parsed = parseYamlSubset(validBugForm);
	assert.equal(parsed.name, 'Bug report');
	assert.equal(parsed.title, 'bug: ');
	assert.equal(parsed.body[0].attributes.options[1], 'Tracking');
	assert.equal(parsed.body[0].validations.required, true);
	const contact = parseYamlSubset(validContactForm);
	assert.equal(contact.body[0].attributes.value, 'This issue is public.\nDo not include sensitive details.\n');
});

test('fails deterministically on malformed indentation', () => {
	const errors = validateIssueTemplateFile('bug_report.yml', `name: Bug\ndescription: Broken\n body:\n  - type: markdown\n`);
	assert.deepEqual(errors, ['bug_report.yml: YAML subset error at line 3: unexpected indentation 1; expected 0']);
});

test('fails on duplicate mapping keys instead of accepting the last value', () => {
	const errors = validateIssueTemplateFile('bug_report.yml', `name: Bug\nname: Other\ndescription: Duplicate\nbody:\n  - type: markdown\n    attributes:\n      value: test\n`);
	assert.deepEqual(errors, ['bug_report.yml: YAML subset error at line 2: duplicate key name']);
});

test('fails closed on unsupported YAML features', () => {
	assert.deepEqual(
		validateIssueTemplateFile('bug_report.yml', `name: Bug\ndescription: Test\nbody: [one, two]\n`),
		['bug_report.yml: YAML subset error at line 3: flow-style collections are not supported'],
	);
	assert.deepEqual(
		validateIssueTemplateFile('bug_report.yml', `name: &name Bug\ndescription: Test\nbody:\n  - type: markdown\n    attributes:\n      value: test\n`),
		['bug_report.yml: YAML subset error at line 1: anchors, aliases, tags, and document markers are not supported'],
	);
});

test('rejects missing required top-level form fields', () => {
	assert.deepEqual(
		validateIssueTemplateFile('bug_report.yml', `name: Bug\ndescription: Test\n`),
		['bug_report.yml: body must be a non-empty sequence'],
	);
});

test('rejects unsupported top-level and body-entry keys', () => {
	const errors = validateIssueTemplateFile('bug_report.yml', `name: Bug\ndescription: Test\nunknown: value\nbody:\n  - type: markdown\n    extra: value\n    attributes:\n      value: test\n`);
	assert.deepEqual(errors, [
		'bug_report.yml: body[0]: unsupported key extra',
		'bug_report.yml: unsupported key unknown',
	]);
});

test('rejects duplicate ids', () => {
	const errors = validateIssueTemplateFile('bug_report.yml', `name: Bug\ndescription: Test\nbody:\n  - type: textarea\n    id: details\n    attributes:\n      label: Details\n  - type: input\n    id: details\n    attributes:\n      label: More details\n`);
	assert.deepEqual(errors, ['bug_report.yml: body[1].id duplicates details']);
});

test('rejects unknown body types rather than treating them as safe', () => {
	const errors = validateIssueTemplateFile('bug_report.yml', `name: Bug\ndescription: Test\nbody:\n  - type: upload\n    id: evidence\n    attributes:\n      label: Evidence\n`);
	assert.deepEqual(errors, ['bug_report.yml: body[0].type must be one of markdown, input, textarea, dropdown, checkboxes']);
});

test('requires a non-empty dropdown option sequence', () => {
	const errors = validateIssueTemplateFile('change_proposal.yml', `name: Change\ndescription: Test\nbody:\n  - type: dropdown\n    id: role\n    attributes:\n      label: Role\n      options:\n`);
	assert.deepEqual(errors, ['change_proposal.yml: body[0].attributes.options must be a non-empty sequence of strings']);
});

test('validates checkbox option shape', () => {
	const errors = validateIssueTemplateFile('bug_report.yml', `name: Bug\ndescription: Test\nbody:\n  - type: checkboxes\n    id: checks\n    attributes:\n      label: Checks\n      options:\n        - label: First\n          required: yes\n        - wrong: Second\n`);
	assert.deepEqual(errors, [
		'bug_report.yml: body[0].attributes.options[0].required must be a boolean',
		'bug_report.yml: body[0].attributes.options[1].label must be a non-empty string',
		'bug_report.yml: body[0].attributes.options[1]: unsupported key wrong',
	]);
});

test('forbids free-text input in the public security contact form', () => {
	const errors = validateIssueTemplateFile('security_contact.yml', `name: Security contact\ndescription: Test\nbody:\n  - type: textarea\n    id: details\n    attributes:\n      label: Details\n`);
	assert.deepEqual(errors, ['security_contact.yml: body[0].type textarea is forbidden in public contact-only forms']);
});

test('forbids input and dropdown fields in the public conduct contact form', () => {
	const errors = validateIssueTemplateFile('conduct_contact.yml', `name: Conduct contact\ndescription: Test\nbody:\n  - type: input\n    id: contact\n    attributes:\n      label: Contact\n  - type: dropdown\n    id: category\n    attributes:\n      label: Category\n      options:\n        - Other\n`);
	assert.deepEqual(errors, [
		'conduct_contact.yml: body[0].type input is forbidden in public contact-only forms',
		'conduct_contact.yml: body[1].type dropdown is forbidden in public contact-only forms',
	]);
});

test('requires every contact-only checkbox acknowledgement explicitly', () => {
	const errors = validateIssueTemplateFile('security_contact.yml', `name: Security contact\ndescription: Test\nbody:\n  - type: checkboxes\n    id: confirmation\n    attributes:\n      label: Confirmation\n      options:\n        - label: Public\n          required: true\n        - label: No secrets\n`);
	assert.deepEqual(errors, ['security_contact.yml: body[0].attributes.options[1] must be explicitly required in public contact-only forms']);
});

test('rejects malformed config links and insecure URLs', () => {
	const errors = validateIssueTemplateFile('config.yml', `blank_issues_enabled: false\ncontact_links:\n  - name: Security\n    url: http://example.com/security\n`);
	assert.deepEqual(errors, [
		'config.yml: contact_links[0].about must be a non-empty string',
		'config.yml: contact_links[0].url must use https',
	]);
});

test('sorts multiple diagnostics deterministically', () => {
	const errors = validateIssueTemplateFile('bug_report.yml', `name: Bug\ndescription: Test\nzeta: value\nalpha: value\nbody:\n  - type: markdown\n    attributes:\n      value: test\n`);
	assert.deepEqual(errors, [
		'bug_report.yml: unsupported key alpha',
		'bug_report.yml: unsupported key zeta',
	]);
});
