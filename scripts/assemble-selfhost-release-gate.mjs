import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
	REQUIRED_SELFHOST_RELEASE_STEPS,
	runSelfhostReleaseGate,
} from './run-selfhost-release-gate.mjs';

export const DEFAULT_ASSEMBLED_RELEASE_GATE_OUTPUT = '.cache/selfhost-required-shadow/release-core.json';
const inputOptions = Object.freeze({
	'seed-verify': 'seed-verify',
	'fixed-seed-bootstrap': 'fixed-seed-bootstrap',
	'clean-bootstrap': 'clean-bootstrap',
	'legacy-rollback': 'legacy-rollback',
});
const scriptToStep = new Map(REQUIRED_SELFHOST_RELEASE_STEPS.map(step => [step.command[1], step.id]));

export async function assembleSelfhostReleaseGate({
	repositoryRoot,
	evidenceById,
	now = () => new Date(),
} = {}) {
	return runSelfhostReleaseGate({
		repositoryRoot,
		now,
		execute: async command => {
			const id = scriptToStep.get(command?.[1]);
			if (id === undefined) {
				return { status: 1, stdout: '', stderr: `Unknown release-gate command: ${String(command?.[1])}` };
			}
			const evidence = evidenceById?.[id];
			if (!isObject(evidence)) {
				return { status: 1, stdout: '', stderr: `Missing precomputed evidence for ${id}.` };
			}
			return { status: 0, stdout: JSON.stringify(evidence), stderr: '' };
		},
	});
}

export function parseArguments(argumentsList) {
	const inputs = {};
	let output = DEFAULT_ASSEMBLED_RELEASE_GATE_OUTPUT;
	let json = false;
	let help = false;
	const seen = new Set();
	for (const argument of argumentsList) {
		if (argument === '--json' || argument === '--help') {
			const name = argument.slice(2);
			if (seen.has(name)) throw new Error(`Duplicate option: ${argument}`);
			seen.add(name);
			if (name === 'json') json = true;
			else help = true;
			continue;
		}
		const option = [...Object.keys(inputOptions), 'output'].find(name => argument.startsWith(`--${name}=`));
		if (option === undefined) throw new Error(`Unknown argument: ${argument}`);
		if (seen.has(option)) throw new Error(`Duplicate option: --${option}`);
		seen.add(option);
		const value = nonEmpty(argument.slice(option.length + 3), `--${option}`);
		if (option === 'output') output = value;
		else inputs[inputOptions[option]] = value;
	}
	if (help && seen.size > 1) throw new Error('--help cannot be combined with other options');
	if (!help) {
		for (const id of Object.values(inputOptions)) {
			if (inputs[id] === undefined) throw new Error(`--${id} is required`);
		}
	}
	return { inputs, output, json, help };
}

export async function main(argumentsList = process.argv.slice(2), injected = {}) {
	const options = parseArguments(argumentsList);
	if (options.help) {
		console.log(helpText());
		return null;
	}
	const repositoryRoot = resolve(injected.repositoryRoot ?? fileURLToPath(new URL('..', import.meta.url)));
	const output = resolveCachePath(repositoryRoot, options.output, '--output');
	let report;
	try {
		const evidenceById = injected.evidenceById ?? Object.fromEntries(await Promise.all(
			Object.entries(options.inputs).map(async ([id, path]) => [id, await readJsonEvidence(repositoryRoot, path, `--${id}`)]),
		));
		report = await assembleSelfhostReleaseGate({
			repositoryRoot,
			evidenceById,
			...(injected.now === undefined ? {} : { now: injected.now }),
		});
	} catch (error) {
		const failure = {
			schemaVersion: 2,
			claim: 'selfhost-stable-release-gate-core',
			productionEligible: false,
			passed: false,
			error: error instanceof Error ? error.message : String(error),
		};
		report = { ...failure, evidenceSha256: sha256(JSON.stringify(failure)) };
	}
	await mkdir(dirname(output.absolutePath), { recursive: true });
	const encoded = `${JSON.stringify(report)}\n`;
	await writeFile(output.absolutePath, encoded, 'utf8');
	if (options.json) process.stdout.write(encoded);
	else console.log(`Assembled self-host release gate: ${report.passed ? 'PASS' : 'FAIL'} (${output.repositoryRelative})`);
	if (!report.passed) throw new Error(`Assembled self-host release gate failed. Evidence: ${output.repositoryRelative}`);
	return report;
}

async function readJsonEvidence(repositoryRoot, value, option) {
	const input = resolveCachePath(repositoryRoot, value, option);
	try {
		const parsed = JSON.parse(await readFile(input.absolutePath, 'utf8'));
		if (!isObject(parsed)) throw new Error('top-level JSON value must be an object');
		return parsed;
	} catch (error) {
		throw new Error(`${option} is not valid JSON evidence: ${error instanceof Error ? error.message : String(error)}`);
	}
}

function resolveCachePath(repositoryRoot, value, option) {
	if (isAbsolute(value)) throw new Error(`${option} must be repository-relative`);
	const absolutePath = resolve(repositoryRoot, value);
	const repositoryRelative = relative(repositoryRoot, absolutePath);
	if (
		repositoryRelative === ''
		|| repositoryRelative === '..'
		|| repositoryRelative.startsWith(`..${sep}`)
		|| isAbsolute(repositoryRelative)
		|| !(repositoryRelative === '.cache' || repositoryRelative.startsWith(`.cache${sep}`))
		|| !repositoryRelative.endsWith('.json')
	) throw new Error(`${option} must be a repository-relative .cache JSON path`);
	return { absolutePath, repositoryRelative: repositoryRelative.replaceAll('\\', '/') };
}

export function helpText() {
	return [
		'Usage: node scripts/assemble-selfhost-release-gate.mjs --seed-verify=<.cache/json> --fixed-seed-bootstrap=<.cache/json> --clean-bootstrap=<.cache/json> --legacy-rollback=<.cache/json> [--output=<.cache/json>] [--json]',
		'',
		'Assembles independently generated evidence through the same fail-closed release-gate evaluator used by run-selfhost-release-gate.mjs.',
		'It does not execute or weaken any proof step and always preserves productionEligible: false.',
	].join('\n');
}

function isObject(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function nonEmpty(value, option) {
	if (typeof value !== 'string' || value.trim() === '') throw new Error(`${option} must be a non-empty string`);
	return value.trim();
}
function sha256(value) { return createHash('sha256').update(value, 'utf8').digest('hex'); }

const directExecution = process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (directExecution) {
	try { await main(); }
	catch (error) {
		console.error(`SELFHOST_RELEASE_GATE_ASSEMBLY_ERROR ${error instanceof Error ? error.message : String(error)}`);
		process.exitCode = 1;
	}
}
