import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const classificationValues = new Set([
	'feature-regression',
	'shared-infrastructure',
	'retryable-transient',
	'unknown',
]);

const evidenceFields = Object.freeze([
	'reproducesOnHead',
	'attributableToChangedBehaviorOrFiles',
	'sameFailureOnUnchangedCode',
	'sameFailureOnUnrelatedPullRequests',
	'boundedExternalFailure',
	'testAssertionFailed',
	'compilerDiagnosticMismatch',
	'compatibilityFailure',
	'securityFailure',
	'reproducibilityFailure',
	'repeatedOnSameHead',
]);

const protectedFailureFields = Object.freeze([
	'testAssertionFailed',
	'compilerDiagnosticMismatch',
	'compatibilityFailure',
	'securityFailure',
	'reproducibilityFailure',
]);

const nextActions = Object.freeze({
	'feature-regression': 'Fix the change and retain regression coverage before rerunning the gate.',
	'shared-infrastructure': 'Record the shared evidence and retry only after the dependency or service recovers.',
	'retryable-transient': 'Retry once on the exact same head SHA. A repeated failure requires investigation.',
	unknown: 'Do not retry blindly. Collect logs and reduce the failure to a supported evidence class.',
});

export function classifySelfhostCiFailure(input) {
	assertPlainObject(input, 'input');
	assertExactKeys(input, [
		'schemaVersion',
		'headSha',
		'workflow',
		'runId',
		'jobId',
		'classification',
		'evidence',
	]);
	if (input.schemaVersion !== 1) throw new Error('schemaVersion must be 1');
	if (typeof input.headSha !== 'string' || !/^[0-9a-f]{40}$/u.test(input.headSha)) {
		throw new Error('headSha must be a lowercase 40-character Git commit SHA');
	}
	assertNonEmptyString(input.workflow, 'workflow');
	assertPositiveSafeInteger(input.runId, 'runId');
	assertPositiveSafeInteger(input.jobId, 'jobId');
	if (!classificationValues.has(input.classification)) {
		throw new Error(`Unsupported classification: ${String(input.classification)}`);
	}

	const evidence = normalizeEvidence(input.evidence);
	validateClassification(input.classification, evidence);
	const retryAllowed = input.classification === 'retryable-transient' && evidence.repeatedOnSameHead === false;

	return {
		schemaVersion: 1,
		claim: 'selfhost-ci-failure-classification',
		headSha: input.headSha,
		workflow: input.workflow,
		runId: input.runId,
		jobId: input.jobId,
		classification: input.classification,
		retryAllowed,
		nextAction: nextActions[input.classification],
		evidence,
	};
}

function normalizeEvidence(value) {
	assertPlainObject(value, 'evidence');
	assertExactKeys(value, evidenceFields);
	const evidence = {};
	for (const field of evidenceFields) {
		if (typeof value[field] !== 'boolean') throw new Error(`evidence.${field} must be boolean`);
		evidence[field] = value[field];
	}
	return evidence;
}

function validateClassification(classification, evidence) {
	if (classification === 'feature-regression') {
		if (!evidence.reproducesOnHead || !evidence.attributableToChangedBehaviorOrFiles) {
			throw new Error('feature-regression requires reproduction on the head and attribution to the changed behavior or files');
		}
		return;
	}
	if (classification === 'shared-infrastructure') {
		if (!evidence.sameFailureOnUnchangedCode && !evidence.sameFailureOnUnrelatedPullRequests) {
			throw new Error('shared-infrastructure requires matching evidence on unchanged code or unrelated pull requests');
		}
		return;
	}
	if (classification === 'retryable-transient') {
		if (!evidence.boundedExternalFailure) {
			throw new Error('retryable-transient requires a bounded external failure');
		}
		for (const field of protectedFailureFields) {
			if (evidence[field]) throw new Error(`retryable-transient cannot be used when evidence.${field} is true`);
		}
		if (evidence.repeatedOnSameHead) {
			throw new Error('retryable-transient cannot be used after the same failure repeats on the same head');
		}
	}
}

function assertPlainObject(value, name) {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error(`${name} must be an object`);
	}
}

function assertExactKeys(value, expectedKeys) {
	const actual = Object.keys(value).sort();
	const expected = [...expectedKeys].sort();
	if (JSON.stringify(actual) !== JSON.stringify(expected)) {
		throw new Error(`Unexpected object keys: expected ${expected.join(', ')}, received ${actual.join(', ')}`);
	}
}

function assertNonEmptyString(value, name) {
	if (typeof value !== 'string' || value.trim() === '') throw new Error(`${name} must be a non-empty string`);
}

function assertPositiveSafeInteger(value, name) {
	if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive safe integer`);
}

async function main() {
	const options = parseArguments(process.argv.slice(2));
	const source = await readFile(options.input, 'utf8');
	const result = classifySelfhostCiFailure(JSON.parse(source));
	const output = `${JSON.stringify(result, null, '\t')}\n`;
	if (options.output === undefined) process.stdout.write(output);
	else await writeFile(options.output, output, 'utf8');
}

function parseArguments(argumentsList) {
	const result = {};
	for (let index = 0; index < argumentsList.length; index += 1) {
		const argument = argumentsList[index];
		if (argument === '--input') result.input = argumentsList[++index];
		else if (argument === '--output') result.output = argumentsList[++index];
		else throw new Error(`Unknown argument: ${argument}`);
	}
	if (result.input === undefined || result.input === '') throw new Error('Provide --input <path>.');
	return result;
}

const entry = process.argv[1] === undefined ? undefined : resolve(process.argv[1]);
if (entry === fileURLToPath(import.meta.url)) await main();
