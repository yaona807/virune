import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const VALID_NON_PR_EVENTS = new Set(['push', 'workflow_dispatch']);
const CI_REQUIRED_SUCCESS_KEYS = Object.freeze([
	'metadata',
	'build',
	'verify',
	'selfhostInventory',
	'quality',
	'compatibility',
	'browser',
	'releaseArtifacts',
]);
const CI_DOCS_SKIPPED_KEYS = Object.freeze([
	'build',
	'verify',
	'selfhostInventory',
	'quality',
	'semanticFuzz',
	'compatibility',
	'browser',
	'releaseArtifacts',
]);

export function verifyOptionalFormalGate({ label, required, classifyResult, upstreamResult }) {
	if (classifyResult !== 'success') {
		throw new Error(`${label} classification concluded with ${displayResult(classifyResult)}.`);
	}
	if (required === 'true') {
		if (upstreamResult !== 'success') {
			throw new Error(`Required ${label} validation concluded with ${displayResult(upstreamResult)}.`);
		}
		return 'required-success';
	}
	if (required === 'false') {
		if (upstreamResult !== 'skipped') {
			throw new Error(`Not-required ${label} validation concluded with unexpected result ${displayResult(upstreamResult)}.`);
		}
		return 'not-required';
	}
	throw new Error(`Invalid formal_required output for ${label}: ${displayResult(required)}.`);
}

export function verifyCiGate({ eventName, docsOnly, classifyResult, results }) {
	if (classifyResult !== 'success') {
		throw new Error(`CI classification concluded with ${displayResult(classifyResult)}.`);
	}
	if (docsOnly === 'true') {
		requireResult(results, 'metadata', 'success', 'Documentation-only CI');
		for (const key of CI_DOCS_SKIPPED_KEYS) requireResult(results, key, 'skipped', 'Documentation-only CI');
		return 'docs-only';
	}
	if (docsOnly !== 'false') {
		throw new Error(`Invalid docs_only output: ${displayResult(docsOnly)}.`);
	}
	for (const key of CI_REQUIRED_SUCCESS_KEYS) requireResult(results, key, 'success', 'Required CI');
	if (eventName === 'pull_request') {
		requireResult(results, 'semanticFuzz', 'success', 'Required pull-request CI');
	} else if (VALID_NON_PR_EVENTS.has(eventName)) {
		requireResult(results, 'semanticFuzz', 'skipped', 'Non-PR CI');
	} else {
		throw new Error(`Unsupported CI event: ${displayResult(eventName)}.`);
	}
	return 'required-success';
}

function requireResult(results, key, expected, label) {
	const actual = results[key];
	if (actual !== expected) {
		throw new Error(`${label} expected ${key}=${expected}, got ${displayResult(actual)}.`);
	}
}

function displayResult(value) {
	return value === undefined || value === '' ? '<missing>' : String(value);
}

function parseArguments(argumentsList) {
	const result = {};
	for (let index = 0; index < argumentsList.length; index++) {
		const argument = argumentsList[index];
		if (!argument.startsWith('--')) throw new Error(`Unexpected argument: ${argument}`);
		const key = argument.slice(2);
		const value = argumentsList[++index];
		if (value === undefined) throw new Error(`Missing value for ${argument}`);
		result[key] = value;
	}
	return result;
}

function main() {
	try {
		const args = parseArguments(process.argv.slice(2));
		if (args.kind === 'optional') {
			const status = verifyOptionalFormalGate({
				label: args.label ?? 'formal',
				required: args.required,
				classifyResult: args['classify-result'],
				upstreamResult: args['upstream-result'],
			});
			process.stdout.write(`${status}\n`);
			return;
		}
		if (args.kind === 'ci') {
			const status = verifyCiGate({
				eventName: args['event-name'],
				docsOnly: args['docs-only'],
				classifyResult: args['classify-result'],
				results: {
					metadata: args.metadata,
					build: args.build,
					verify: args.verify,
					selfhostInventory: args['selfhost-inventory'],
					quality: args.quality,
					semanticFuzz: args['semantic-fuzz'],
					compatibility: args.compatibility,
					browser: args.browser,
					releaseArtifacts: args['release-artifacts'],
				},
			});
			process.stdout.write(`${status}\n`);
			return;
		}
		throw new Error(`Unknown gate kind: ${displayResult(args.kind)}.`);
	} catch (error) {
		process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
		process.exitCode = 1;
	}
}

const entry = process.argv[1] === undefined ? undefined : resolve(process.argv[1]);
if (entry === fileURLToPath(import.meta.url)) main();
