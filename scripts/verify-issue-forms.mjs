import { lstat, readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const githubDirectory = '.github';
const issueTemplateDirectory = '.github/ISSUE_TEMPLATE';
const requiredTemplateFiles = [
	'bug_report.yml',
	'change_proposal.yml',
	'conduct_contact.yml',
	'config.yml',
];
const contactOnlyForms = new Set(['conduct_contact.yml', 'security_contact.yml']);
const allowedFormTopLevel = new Set(['name', 'description', 'title', 'labels', 'assignees', 'body']);
const allowedBodyTypes = new Set(['markdown', 'input', 'textarea', 'dropdown', 'checkboxes']);
const githubBooleanTrue = new Set(['y', 'Y', 'yes', 'Yes', 'YES', 'true', 'True', 'TRUE', 'on', 'On', 'ON']);
const githubBooleanFalse = new Set(['n', 'N', 'no', 'No', 'NO', 'false', 'False', 'FALSE', 'off', 'Off', 'OFF']);

export async function verifyIssueForms(root = repositoryRoot) {
	const githubPath = resolve(root, githubDirectory);
	let githubStat;
	try {
		githubStat = await lstat(githubPath);
	} catch (error) {
		if (error?.code === 'ENOENT') return [`${githubDirectory}: required repository metadata directory is missing`];
		throw error;
	}
	if (!githubStat.isDirectory() || githubStat.isSymbolicLink()) {
		return [`${githubDirectory}: repository metadata path must be a real directory`];
	}

	const directory = resolve(root, issueTemplateDirectory);
	let directoryStat;
	try {
		directoryStat = await lstat(directory);
	} catch (error) {
		if (error?.code === 'ENOENT') return [`${issueTemplateDirectory}: required Issue Template directory is missing`];
		throw error;
	}
	if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
		return [`${issueTemplateDirectory}: Issue Template path must be a real directory`];
	}
	const dirents = await readdir(directory, { withFileTypes: true });
	const errors = [];
	const filenameIdentities = new Map();
	for (const entry of [...dirents].sort((left, right) => compareCodePoint(left.name, right.name))) {
		if (!/\.(?:ya?ml|md)$/iu.test(entry.name)) continue;
		const identity = entry.name.toLowerCase();
		const previous = filenameIdentities.get(identity);
		if (previous === undefined) filenameIdentities.set(identity, entry.name);
		else errors.push(`${entry.name}: template filename collides case-insensitively with ${previous}`);
		if (!entry.isFile()) errors.push(`${entry.name}: Issue Template entry must be a regular file`);
	}
	const directoryEntries = dirents
		.filter(entry => entry.isFile())
		.map(entry => entry.name)
		.sort(compareCodePoint);
	const entries = directoryEntries.filter(name => /\.yml$/iu.test(name));
	for (const name of directoryEntries.filter(name => /\.yaml$/iu.test(name))) {
		errors.push(`${name}: GitHub Issue Forms require the .yml extension; .yaml is unsupported`);
	}
	for (const name of directoryEntries.filter(name => /\.md$/iu.test(name))) {
		errors.push(`${name}: Markdown Issue Templates are outside the supported repository subset; extend the validator before adding one`);
	}
	const present = new Set(entries);
	const formNames = new Map();
	for (const required of requiredTemplateFiles) {
		if (!present.has(required)) errors.push(`${required}: required canonical Issue Template file is missing`);
	}
	for (const name of entries) {
		const source = await readFile(resolve(directory, name), 'utf8');
		errors.push(...validateIssueTemplateFile(name, source));
		if (name === 'config.yml') continue;
		try {
			const document = parseYamlSubset(source);
			if (!isRecord(document) || typeof document.name !== 'string' || document.name.trim() === '') continue;
			const previous = formNames.get(document.name);
			if (previous === undefined) formNames.set(document.name, name);
			else errors.push(`${name}: name duplicates ${previous}: ${document.name}`);
		} catch {
			// The primary validation already records the deterministic YAML diagnostic.
		}
	}
	return errors.sort(compareCodePoint);
}

export function validateIssueTemplateFile(name, source) {
	let document;
	try {
		document = parseYamlSubset(source);
	} catch (error) {
		return [`${name}: ${error.message}`];
	}
	const errors = [];
	if (name === 'config.yml') validateConfig(name, document, errors);
	else validateIssueForm(name, document, errors);
	return errors.sort(compareCodePoint);
}

function validateConfig(name, document, errors) {
	if (!isRecord(document)) {
		errors.push(`${name}: top level must be a mapping`);
		return;
	}
	allowOnlyKeys(name, document, new Set(['blank_issues_enabled', 'contact_links']), errors);
	if (typeof document.blank_issues_enabled !== 'boolean') {
		errors.push(`${name}: blank_issues_enabled must be a boolean`);
	}
	if (!Array.isArray(document.contact_links)) {
		errors.push(`${name}: contact_links must be a sequence`);
		return;
	}
	for (const [index, link] of document.contact_links.entries()) {
		const path = `${name}: contact_links[${index}]`;
		if (!isRecord(link)) {
			errors.push(`${path} must be a mapping`);
			continue;
		}
		allowOnlyKeys(path, link, new Set(['name', 'url', 'about']), errors);
		requireNonEmptyString(path, link, 'name', errors);
		requireNonEmptyString(path, link, 'url', errors);
		requireNonEmptyString(path, link, 'about', errors);
	}
}

function validateIssueForm(name, document, errors) {
	if (!isRecord(document)) {
		errors.push(`${name}: top level must be a mapping`);
		return;
	}
	allowOnlyKeys(name, document, allowedFormTopLevel, errors);
	requireNonEmptyString(name, document, 'name', errors);
	if (typeof document.name === 'string' && document.name.trim() !== '' && [...document.name].length <= 3) {
		errors.push(`${name}: name must be longer than 3 characters`);
	}
	requireNonEmptyString(name, document, 'description', errors);
	if ('title' in document && typeof document.title !== 'string') errors.push(`${name}: title must be a string`);
	validateStringSequence(name, document, 'labels', errors);
	validateStringSequence(name, document, 'assignees', errors);
	if (!Array.isArray(document.body) || document.body.length === 0) {
		errors.push(`${name}: body must be a non-empty sequence`);
		return;
	}
	if (document.body.every(entry => isRecord(entry) && entry.type === 'markdown')) {
		errors.push(`${name}: body must contain at least one non-markdown field`);
	}
	const ids = new Set();
	for (const [index, entry] of document.body.entries()) validateBodyEntry(name, entry, index, ids, errors);
	if (contactOnlyForms.has(name)) validateContactOnlyForm(name, document.body, errors);
}

function validateBodyEntry(name, entry, index, ids, errors) {
	const path = `${name}: body[${index}]`;
	if (!isRecord(entry)) {
		errors.push(`${path} must be a mapping`);
		return;
	}
	allowOnlyKeys(path, entry, new Set(['type', 'id', 'attributes', 'validations']), errors);
	if (typeof entry.type !== 'string' || !allowedBodyTypes.has(entry.type)) {
		errors.push(`${path}.type must be one of ${[...allowedBodyTypes].join(', ')}`);
		return;
	}
	if (entry.type === 'markdown') {
		if ('id' in entry) errors.push(`${path}: markdown entries must not define id`);
		if ('validations' in entry) errors.push(`${path}: markdown entries must not define validations`);
	} else {
		if (typeof entry.id !== 'string' || !/^[A-Za-z0-9_-]+$/u.test(entry.id)) {
			errors.push(`${path}.id must match [A-Za-z0-9_-]+`);
		} else if (ids.has(entry.id)) {
			errors.push(`${path}.id duplicates ${entry.id}`);
		} else {
			ids.add(entry.id);
		}
	}
	if (!isRecord(entry.attributes)) {
		errors.push(`${path}.attributes must be a mapping`);
		return;
	}
	if ('validations' in entry && entry.type !== 'markdown') {
		if (!isRecord(entry.validations)) errors.push(`${path}.validations must be a mapping`);
		else {
			allowOnlyKeys(`${path}.validations`, entry.validations, new Set(['required']), errors);
			if ('required' in entry.validations && typeof entry.validations.required !== 'boolean') {
				errors.push(`${path}.validations.required must be a boolean`);
			}
		}
	}
	if (entry.type === 'markdown') validateMarkdown(path, entry.attributes, errors);
	else if (entry.type === 'input') validateInput(path, entry.attributes, errors);
	else if (entry.type === 'textarea') validateTextarea(path, entry.attributes, errors);
	else if (entry.type === 'dropdown') validateDropdown(path, entry.attributes, errors);
	else validateCheckboxes(path, entry.attributes, errors);
}

function validateMarkdown(path, attributes, errors) {
	allowOnlyKeys(`${path}.attributes`, attributes, new Set(['value']), errors);
	requireNonEmptyString(`${path}.attributes`, attributes, 'value', errors);
}

function validateInput(path, attributes, errors) {
	allowOnlyKeys(`${path}.attributes`, attributes, new Set(['label', 'description', 'placeholder', 'value']), errors);
	requireNonEmptyString(`${path}.attributes`, attributes, 'label', errors);
	validateOptionalStrings(`${path}.attributes`, attributes, ['description', 'placeholder', 'value'], errors);
}

function validateTextarea(path, attributes, errors) {
	allowOnlyKeys(`${path}.attributes`, attributes, new Set(['label', 'description', 'placeholder', 'value', 'render']), errors);
	requireNonEmptyString(`${path}.attributes`, attributes, 'label', errors);
	validateOptionalStrings(`${path}.attributes`, attributes, ['description', 'placeholder', 'value', 'render'], errors);
}

function validateDropdown(path, attributes, errors) {
	allowOnlyKeys(`${path}.attributes`, attributes, new Set(['label', 'description', 'multiple', 'options']), errors);
	requireNonEmptyString(`${path}.attributes`, attributes, 'label', errors);
	validateOptionalStrings(`${path}.attributes`, attributes, ['description'], errors);
	if ('multiple' in attributes && typeof attributes.multiple !== 'boolean') {
		errors.push(`${path}.attributes.multiple must be a boolean`);
	}
	if (!Array.isArray(attributes.options) || attributes.options.length === 0 || attributes.options.some(option => typeof option !== 'string' || option.trim() === '')) {
		errors.push(`${path}.attributes.options must be a non-empty sequence of strings`);
		return;
	}
	if (new Set(attributes.options).size !== attributes.options.length) {
		errors.push(`${path}.attributes.options choices must be distinct`);
	}
	if (attributes.options.includes('None')) {
		errors.push(`${path}.attributes.options must not include reserved choice None`);
	}
}

function validateCheckboxes(path, attributes, errors) {
	allowOnlyKeys(`${path}.attributes`, attributes, new Set(['label', 'description', 'options']), errors);
	requireNonEmptyString(`${path}.attributes`, attributes, 'label', errors);
	validateOptionalStrings(`${path}.attributes`, attributes, ['description'], errors);
	if (!Array.isArray(attributes.options) || attributes.options.length === 0) {
		errors.push(`${path}.attributes.options must be a non-empty sequence`);
		return;
	}
	const labels = new Set();
	for (const [index, option] of attributes.options.entries()) {
		const optionPath = `${path}.attributes.options[${index}]`;
		if (!isRecord(option)) {
			errors.push(`${optionPath} must be a mapping`);
			continue;
		}
		allowOnlyKeys(optionPath, option, new Set(['label', 'required']), errors);
		requireNonEmptyString(optionPath, option, 'label', errors);
		if (typeof option.label === 'string' && option.label.trim() !== '') {
			if (labels.has(option.label)) errors.push(`${optionPath}.label duplicates ${option.label}`);
			else labels.add(option.label);
		}
		if ('required' in option && typeof option.required !== 'boolean') {
			errors.push(`${optionPath}.required must be a boolean`);
		}
	}
}

function validateContactOnlyForm(name, body, errors) {
	for (const [index, entry] of body.entries()) {
		if (!isRecord(entry) || typeof entry.type !== 'string') continue;
		if (entry.type !== 'markdown' && entry.type !== 'checkboxes') {
			errors.push(`${name}: body[${index}].type ${entry.type} is forbidden in public contact-only forms`);
		}
		if (entry.type === 'checkboxes' && isRecord(entry.attributes) && Array.isArray(entry.attributes.options)) {
			for (const [optionIndex, option] of entry.attributes.options.entries()) {
				if (!isRecord(option) || option.required !== true) {
					errors.push(`${name}: body[${index}].attributes.options[${optionIndex}] must be explicitly required in public contact-only forms`);
				}
			}
		}
	}
}

function validateStringSequence(name, document, key, errors) {
	if (!(key in document)) return;
	if (!Array.isArray(document[key]) || document[key].some(value => typeof value !== 'string')) {
		errors.push(`${name}: ${key} must be a sequence of strings`);
	}
}

function validateOptionalStrings(path, object, keys, errors) {
	for (const key of keys) {
		if (key in object && typeof object[key] !== 'string') errors.push(`${path}.${key} must be a string`);
	}
}

function requireNonEmptyString(path, object, key, errors) {
	if (typeof object[key] !== 'string' || object[key].trim() === '') errors.push(`${path}.${key} must be a non-empty string`);
}

function allowOnlyKeys(path, object, allowed, errors) {
	for (const key of Object.keys(object).sort(compareCodePoint)) {
		if (!allowed.has(key)) errors.push(`${path}: unsupported key ${key}`);
	}
}

function isRecord(value) {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function compareCodePoint(left, right) {
	return left < right ? -1 : left > right ? 1 : 0;
}

export function parseYamlSubset(source) {
	const lines = source.replace(/\r\n?/gu, '\n').split('\n').map((raw, index) => ({ raw, number: index + 1 }));
	for (const line of lines) {
		const prefix = line.raw.match(/^[\t ]*/u)?.[0] ?? '';
		if (prefix.includes('\t')) throw yamlError(line.number, 'tabs are not supported for indentation');
		if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(line.raw)) {
			throw yamlError(line.number, 'unsupported control character');
		}
	}
	return new StrictYamlSubsetParser(lines).parseDocument();
}

class StrictYamlSubsetParser {
	constructor(lines) {
		this.lines = lines;
		this.index = 0;
	}

	parseDocument() {
		this.skipIgnorable();
		if (this.index >= this.lines.length) throw yamlError(1, 'document is empty');
		const indent = indentation(this.lines[this.index].raw);
		if (indent !== 0) throw yamlError(this.lines[this.index].number, 'top-level content must start at indentation 0');
		const value = this.parseBlock(0);
		this.skipIgnorable();
		if (this.index < this.lines.length) throw yamlError(this.lines[this.index].number, 'unexpected trailing content');
		return value;
	}

	parseBlock(indent) {
		this.skipIgnorable();
		const line = this.lines[this.index];
		if (!line) throw yamlError(this.lines.at(-1)?.number ?? 1, 'expected nested content');
		if (indentation(line.raw) !== indent) throw yamlError(line.number, `expected indentation ${indent}`);
		return line.raw.slice(indent).startsWith('- ') ? this.parseSequence(indent) : this.parseMapping(indent);
	}

	parseMapping(indent) {
		const output = Object.create(null);
		while (this.index < this.lines.length) {
			this.skipIgnorable();
			const line = this.lines[this.index];
			if (!line) break;
			const currentIndent = indentation(line.raw);
			if (currentIndent < indent) break;
			if (currentIndent > indent) throw yamlError(line.number, `unexpected indentation ${currentIndent}; expected ${indent}`);
			const text = line.raw.slice(indent);
			if (text.startsWith('- ')) break;
			const { key, valueText } = splitMappingEntry(text, line.number);
			if (Object.prototype.hasOwnProperty.call(output, key)) throw yamlError(line.number, `duplicate key ${key}`);
			this.index += 1;
			output[key] = this.parseValueAfterKey(indent, valueText, line.number);
		}
		return output;
	}

	parseSequence(indent) {
		const output = [];
		while (this.index < this.lines.length) {
			this.skipIgnorable();
			const line = this.lines[this.index];
			if (!line) break;
			const currentIndent = indentation(line.raw);
			if (currentIndent < indent) break;
			if (currentIndent > indent) throw yamlError(line.number, `unexpected indentation ${currentIndent}; expected ${indent}`);
			const text = line.raw.slice(indent);
			if (!text.startsWith('- ')) break;
			const itemText = text.slice(2).trimEnd();
			this.index += 1;
			if (itemText === '') {
				output.push(this.parseRequiredNested(indent, line.number));
				continue;
			}
			if (looksLikeMappingEntry(itemText)) {
				const item = Object.create(null);
				const { key, valueText } = splitMappingEntry(itemText, line.number);
				item[key] = this.parseValueAfterKey(indent + 2, valueText, line.number);
				this.parseMappingContinuation(item, indent + 2);
				output.push(item);
				continue;
			}
			output.push(parseScalar(itemText, line.number));
		}
		return output;
	}

	parseMappingContinuation(output, indent) {
		while (this.index < this.lines.length) {
			this.skipIgnorable();
			const line = this.lines[this.index];
			if (!line) return;
			const currentIndent = indentation(line.raw);
			if (currentIndent < indent) return;
			if (currentIndent > indent) throw yamlError(line.number, `unexpected indentation ${currentIndent}; expected ${indent}`);
			const text = line.raw.slice(indent);
			if (text.startsWith('- ')) return;
			const { key, valueText } = splitMappingEntry(text, line.number);
			if (Object.prototype.hasOwnProperty.call(output, key)) throw yamlError(line.number, `duplicate key ${key}`);
			this.index += 1;
			output[key] = this.parseValueAfterKey(indent, valueText, line.number);
		}
	}

	parseValueAfterKey(parentIndent, valueText, lineNumber) {
		const value = valueText.trim();
		if (value === '|') return this.parseBlockScalar(parentIndent, lineNumber);
		if (value === '>') throw yamlError(lineNumber, 'folded block scalars are not supported');
		if (value !== '') return parseScalar(value, lineNumber);
		this.skipIgnorable();
		const next = this.lines[this.index];
		if (!next || indentation(next.raw) <= parentIndent) return null;
		const childIndent = indentation(next.raw);
		if (childIndent !== parentIndent + 2) throw yamlError(next.number, `nested content must use indentation ${parentIndent + 2}`);
		return this.parseBlock(childIndent);
	}

	parseRequiredNested(parentIndent, lineNumber) {
		this.skipIgnorable();
		const next = this.lines[this.index];
		if (!next || indentation(next.raw) <= parentIndent) throw yamlError(lineNumber, 'sequence item requires nested content');
		const childIndent = indentation(next.raw);
		if (childIndent !== parentIndent + 2) throw yamlError(next.number, `nested content must use indentation ${parentIndent + 2}`);
		return this.parseBlock(childIndent);
	}

	parseBlockScalar(parentIndent, lineNumber) {
		const content = [];
		let contentIndent = null;
		while (this.index < this.lines.length) {
			const line = this.lines[this.index];
			if (line.raw.trim() === '') {
				content.push('');
				this.index += 1;
				continue;
			}
			const currentIndent = indentation(line.raw);
			if (currentIndent <= parentIndent) break;
			if (contentIndent === null) contentIndent = currentIndent;
			if (currentIndent < contentIndent) throw yamlError(line.number, 'block scalar indentation decreased unexpectedly');
			content.push(line.raw.slice(contentIndent));
			this.index += 1;
		}
		if (contentIndent === null) throw yamlError(lineNumber, 'block scalar requires content');
		while (content.at(-1) === '') content.pop();
		return `${content.join('\n')}\n`;
	}

	skipIgnorable() {
		while (this.index < this.lines.length) {
			const trimmed = this.lines[this.index].raw.trim();
			if (trimmed !== '' && !trimmed.startsWith('#')) break;
			this.index += 1;
		}
	}
}

function indentation(raw) {
	return raw.length - raw.trimStart().length;
}

function looksLikeMappingEntry(text) {
	return /^[A-Za-z0-9_-]+:(?:\s|$)/u.test(text);
}

function splitMappingEntry(text, lineNumber) {
	const match = text.match(/^([A-Za-z0-9_-]+):(.*)$/u);
	if (!match) throw yamlError(lineNumber, 'expected key: value mapping entry');
	return { key: match[1], valueText: match[2] };
}

function parseScalar(text, lineNumber) {
	if (text === '---' || text === '...') throw yamlError(lineNumber, 'document markers are not supported');
	if (text.startsWith('&') || text.startsWith('*') || text.startsWith('!')) throw yamlError(lineNumber, 'anchors, aliases, and tags are not supported');
	if (text.startsWith('[') || text.startsWith('{')) throw yamlError(lineNumber, 'flow-style collections are not supported');
	if (text === '|' || text === '>') throw yamlError(lineNumber, 'block-scalar indicators are not supported in this position');
	if (text.startsWith('"')) {
		try {
			const parsed = JSON.parse(text);
			if (typeof parsed !== 'string') throw new Error('not a string');
			return parsed;
		} catch {
			throw yamlError(lineNumber, 'invalid double-quoted string');
		}
	}
	if (text.startsWith("'")) {
		if (!text.endsWith("'") || text.length < 2) throw yamlError(lineNumber, 'invalid single-quoted string');
		const inner = text.slice(1, -1);
		let parsed = '';
		for (let index = 0; index < inner.length; index += 1) {
			if (inner[index] !== "'") {
				parsed += inner[index];
				continue;
			}
			if (inner[index + 1] !== "'") throw yamlError(lineNumber, 'invalid single-quoted string');
			parsed += "'";
			index += 1;
		}
		return parsed;
	}
	if (githubBooleanTrue.has(text)) return true;
	if (githubBooleanFalse.has(text)) return false;
	if (/^(?:null|Null|NULL|~)$/u.test(text)) return null;
	if (/^-?(?:0|[1-9][0-9]*)$/u.test(text)) return Number(text);
	if (/^[+-]?(?:[0-9]+\.[0-9]*|\.[0-9]+|[0-9]+(?:\.[0-9]*)?[eE][+-]?[0-9]+)$/u.test(text)) {
		throw yamlError(lineNumber, 'non-integer numeric scalars are not supported');
	}
	if (!/^[A-Za-z_]/u.test(text)) throw yamlError(lineNumber, 'plain strings must start with an ASCII letter or underscore in the supported subset');
	if (/:\s/u.test(text)) throw yamlError(lineNumber, 'plain strings containing colon followed by whitespace are not supported');
	if (/\s+#/u.test(text)) throw yamlError(lineNumber, 'inline comments are not supported; use a full-line comment');
	return text;
}

function yamlError(line, message) {
	return new Error(`YAML subset error at line ${line}: ${message}`);
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
	const errors = await verifyIssueForms();
	if (errors.length > 0) throw new Error(`Issue Form verification failed:\n${errors.map(error => `- ${error}`).join('\n')}`);
	console.log('Verified canonical GitHub Issue Form/config files, strict YAML subset, schema subset, and contact-only privacy invariants.');
}
