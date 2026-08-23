import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const CROSS_RUNNER_REPRODUCIBILITY_SCHEMA_VERSION = 1;
export const DEFAULT_COMPARISON_OUTPUT = '.cache/selfhost/clean-bootstrap-reproducibility.json';
const requiredProfiles = ['baseline', 'perturbed'];
const perturbationDimensions = ['timezone', 'locale', 'homeVariant', 'tempVariant'];
const cleanBootstrapCommands = ['install', 'seed-verify', 'bootstrap'];
const canonicalCleanBootstrapCommands = [...cleanBootstrapCommands];

export function compareCleanBootstrapEvidence(values) {
	if (!Array.isArray(values) || values.length !== 2) {
		throw new Error('Exactly two independent clean-bootstrap evidence inputs are required');
	}
	const normalized = values.map((value, index) => validateEvidence(value, `input[${index}]`))
		.sort((left, right) => compareText(left.environment.profile, right.environment.profile));
	assertEqual(normalized.map(value => value.environment.profile), requiredProfiles, 'environment profiles');
	const [baseline, perturbed] = normalized;
	for (const [field, left, right] of [
		['repositoryCommit', baseline.repositoryCommit, perturbed.repositoryCommit],
		['candidateSha256', baseline.candidateSha256, perturbed.candidateSha256],
		['lockfileSha256', baseline.lockfileSha256, perturbed.lockfileSha256],
		['seed.manifestSha256', baseline.seed.manifestSha256, perturbed.seed.manifestSha256],
		['seed.artifactSha256', baseline.seed.artifactSha256, perturbed.seed.artifactSha256],
		['bootstrap.seedSha256', baseline.bootstrap.seedSha256, perturbed.bootstrap.seedSha256],
		['bootstrap.stage1Sha256', baseline.bootstrap.stage1Sha256, perturbed.bootstrap.stage1Sha256],
		['bootstrap.stage2Sha256', baseline.bootstrap.stage2Sha256, perturbed.bootstrap.stage2Sha256],
		['bootstrap.stage3Sha256', baseline.bootstrap.stage3Sha256, perturbed.bootstrap.stage3Sha256],
	]) {
		if (left !== right) throw new Error(`Cross-runner ${field} mismatch`);
	}
	if (perturbationDimensions.every(field => baseline.environment[field] === perturbed.environment[field])) {
		throw new Error('Environment perturbation dimensions did not actually differ');
	}
	const report = {
		schemaVersion: CROSS_RUNNER_REPRODUCIBILITY_SCHEMA_VERSION,
		claim: 'selfhost-clean-bootstrap-cross-runner-reproducibility',
		productionEligible: false,
		status: 'match',
		equivalent: true,
		independentRunCount: 2,
		repositoryCommit: baseline.repositoryCommit,
		candidateSha256: baseline.candidateSha256,
		lockfileSha256: baseline.lockfileSha256,
		seed: baseline.seed,
		bootstrap: baseline.bootstrap,
		profiles: normalized.map(value => ({
			profile: value.environment.profile,
			timezone: value.environment.timezone,
			locale: value.environment.locale,
			homeVariant: value.environment.homeVariant,
			tempVariant: value.environment.tempVariant,
			evidenceSha256: value.evidenceSha256,
		})),
	};
	return {
		...report,
		evidenceSha256: sha256(JSON.stringify(report)),
	};
}

export function parseArguments(argumentsList) {
	let baseline = null;
	let perturbed = null;
	let output = DEFAULT_COMPARISON_OUTPUT;
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
		const option = ['baseline', 'perturbed', 'output'].find(name => argument.startsWith(`--${name}=`));
		if (option === undefined) throw new Error(`Unknown argument: ${argument}`);
		if (seen.has(option)) throw new Error(`Duplicate option: --${option}`);
		seen.add(option);
		const value = nonEmpty(argument.slice(option.length + 3), `--${option}`);
		if (option === 'baseline') baseline = value;
		else if (option === 'perturbed') perturbed = value;
		else output = value;
	}
	if (help && seen.size > 1) throw new Error('--help cannot be combined with other options');
	if (!help && (baseline === null || perturbed === null)) {
		throw new Error('--baseline and --perturbed are required');
	}
	return { baseline, perturbed, output, json, help };
}

export function helpText() {
	return [
		'Usage: node scripts/compare-selfhost-clean-bootstrap-evidence.mjs --baseline=<json> --perturbed=<json> [--output=<.cache/file.json>] [--json]',
		'',
		'Fail-closed comparison of two independently executed clean-bootstrap proofs.',
		'Requires the same repository commit, fixed Seed, Stage 1/2/3 artifact digests, lockfile and exact Stage 3 candidate SHA across baseline and perturbed environments.',
	].join('\n');
}

export async function main(argumentsList = process.argv.slice(2), injected = {}) {
	const options = parseArguments(argumentsList);
	if (options.help) {
		console.log(helpText());
		return null;
	}
	const root = resolve(injected.repositoryRoot ?? process.cwd());
	const output = resolveCachePath(root, options.output, '--output');
	let result;
	try {
		const [baseline, perturbed] = injected.evidence === undefined
			? await Promise.all([
				readJson(resolvePath(root, options.baseline)),
				readJson(resolvePath(root, options.perturbed)),
			])
			: injected.evidence;
		result = compareCleanBootstrapEvidence([baseline, perturbed]);
	} catch (error) {
		result = {
			schemaVersion: CROSS_RUNNER_REPRODUCIBILITY_SCHEMA_VERSION,
			claim: 'selfhost-clean-bootstrap-cross-runner-reproducibility',
			productionEligible: false,
			status: 'mismatch',
			equivalent: false,
			error: error instanceof Error ? error.message : String(error),
		};
	}
	await mkdir(dirname(output.absolutePath), { recursive: true });
	const encoded = `${JSON.stringify(result)}\n`;
	await writeFile(output.absolutePath, encoded, 'utf8');
	if (options.json) process.stdout.write(encoded);
	else {
		console.log(`Cross-runner clean bootstrap: ${result.status.toUpperCase()}`);
		console.log(`Evidence: ${output.repositoryRelative}`);
	}
	if (result.status !== 'match') throw new Error(`Cross-runner clean bootstrap did not match. Evidence: ${output.repositoryRelative}`);
	return result;
}

function validateEvidence(value, path) {
	const input = record(value, path);
	exactKeys(input, ['schemaVersion','claim','productionEligible','status','passed','candidateSha256','repositoryCommit','checkedAt','workingTreeClean','dependencyMode','environment','lockfileSha256','seed','bootstrap','commands','failures','evidenceSha256'], path);
	if (input.schemaVersion !== 2) throw new Error(`${path}.schemaVersion must be 2`);
	if (input.claim !== 'selfhost-clean-bootstrap-fixed-point') throw new Error(`${path}.claim is invalid`);
	if (input.productionEligible !== false) throw new Error(`${path}.productionEligible must remain false`);
	if (input.status !== 'pass' || input.passed !== true) throw new Error(`${path} is not a passing clean-bootstrap proof`);
	if (input.workingTreeClean !== true) throw new Error(`${path}.workingTreeClean must be true`);
	if (input.dependencyMode !== 'offline') throw new Error(`${path}.dependencyMode must be offline`);
	const repositoryCommit = sha1(input.repositoryCommit, `${path}.repositoryCommit`);
	const candidateSha256 = sha256Value(input.candidateSha256, `${path}.candidateSha256`);
	const checkedAt = timestamp(input.checkedAt, `${path}.checkedAt`);
	const lockfileSha256 = sha256Value(input.lockfileSha256, `${path}.lockfileSha256`);
	const evidenceSha256 = sha256Value(input.evidenceSha256, `${path}.evidenceSha256`);
	const seedValue = record(input.seed, `${path}.seed`);
	exactKeys(seedValue, ['manifestSha256','artifactSha256','verified'], `${path}.seed`);
	const seed = {
		manifestSha256: sha256Value(seedValue.manifestSha256, `${path}.seed.manifestSha256`),
		artifactSha256: sha256Value(seedValue.artifactSha256, `${path}.seed.artifactSha256`),
		verified: seedValue.verified,
	};
	if (seed.verified !== true) throw new Error(`${path}.seed.verified must be true`);
	const bootstrapValue = record(input.bootstrap, `${path}.bootstrap`);
	exactKeys(bootstrapValue, ['seedSha256','stage1Sha256','stage2Sha256','stage3Sha256','fixedPointEquivalent','fixedPointDifferenceCount'], `${path}.bootstrap`);
	const bootstrap = {
		seedSha256: sha256Value(bootstrapValue.seedSha256, `${path}.bootstrap.seedSha256`),
		stage1Sha256: sha256Value(bootstrapValue.stage1Sha256, `${path}.bootstrap.stage1Sha256`),
		stage2Sha256: sha256Value(bootstrapValue.stage2Sha256, `${path}.bootstrap.stage2Sha256`),
		stage3Sha256: sha256Value(bootstrapValue.stage3Sha256, `${path}.bootstrap.stage3Sha256`),
		fixedPointEquivalent: bootstrapValue.fixedPointEquivalent,
		fixedPointDifferenceCount: bootstrapValue.fixedPointDifferenceCount,
	};
	if (bootstrap.fixedPointEquivalent !== true || bootstrap.fixedPointDifferenceCount !== 0 || bootstrap.stage2Sha256 !== bootstrap.stage3Sha256) {
		throw new Error(`${path} does not contain an exact Stage 2/3 fixed point`);
	}
	if (bootstrap.seedSha256 !== seed.artifactSha256) throw new Error(`${path}.bootstrap.seedSha256 does not match the verified Seed`);
	if (candidateSha256 !== bootstrap.stage3Sha256) throw new Error(`${path}.candidateSha256 is not the Stage 3 digest`);
	const environmentValue = record(input.environment, `${path}.environment`);
	exactKeys(environmentValue, ['profile','timezone','locale','homeVariant','tempVariant'], `${path}.environment`);
	if (!requiredProfiles.includes(environmentValue.profile)) throw new Error(`${path}.environment.profile is invalid`);
	const environment = {
		profile: environmentValue.profile,
		timezone: nonEmpty(environmentValue.timezone, `${path}.environment.timezone`),
		locale: nonEmpty(environmentValue.locale, `${path}.environment.locale`),
		homeVariant: nonEmpty(environmentValue.homeVariant, `${path}.environment.homeVariant`),
		tempVariant: nonEmpty(environmentValue.tempVariant, `${path}.environment.tempVariant`),
	};
	if (!Array.isArray(input.failures) || input.failures.length !== 0) throw new Error(`${path}.failures must be an empty array for passing evidence`);
	if (!Array.isArray(input.commands) || input.commands.length !== canonicalCleanBootstrapCommands.length) throw new Error(`${path}.commands must contain exactly the required commands`);
	const commands = input.commands.map((command, index) => validateCommand(command, canonicalCleanBootstrapCommands[index], `${path}.commands[${index}]`));
	const canonicalReport = {
		version: 2,
		candidateSha256,
		repositoryCommit,
		checkedAt,
		status: 'pass',
		failures: [],
		workingTreeClean: true,
		dependencyMode: 'offline',
		environment,
		lockfileSha256,
		seed,
		bootstrap,
		commands,
	};
	if (sha256(JSON.stringify(canonicalReport)) !== evidenceSha256) throw new Error(`${path}.evidenceSha256 does not match canonical clean-bootstrap evidence`);
	return { repositoryCommit, candidateSha256, lockfileSha256, evidenceSha256, seed: { manifestSha256: seed.manifestSha256, artifactSha256: seed.artifactSha256 }, bootstrap: { seedSha256: bootstrap.seedSha256, stage1Sha256: bootstrap.stage1Sha256, stage2Sha256: bootstrap.stage2Sha256, stage3Sha256: bootstrap.stage3Sha256 }, environment };
}

function validateCommand(value, expectedName, path) {
	const command = record(value, path);
	exactKeys(command, ['name','exitCode','stdoutSha256','stderrSha256'], path);
	if (command.name !== expectedName) throw new Error(`${path}.name must be ${expectedName}`);
	if (command.exitCode !== 0) throw new Error(`${path}.exitCode must be zero`);
	return {
		name: expectedName,
		exitCode: 0,
		stdoutSha256: sha256Value(command.stdoutSha256, `${path}.stdoutSha256`),
		stderrSha256: sha256Value(command.stderrSha256, `${path}.stderrSha256`),
	};
}

async function readJson(path) { return JSON.parse(await readFile(path, 'utf8')); }
function assertEqual(actual, expected, label) {
	if (actual.length !== expected.length || actual.some((value, index) => value !== expected[index])) {
		throw new Error(`Cross-runner ${label} must be ${expected.join(', ')}`);
	}
}
function exactKeys(value, expected, path) {
	const actual = Object.keys(value).sort(compareText);
	const wanted = [...expected].sort(compareText);
	if (JSON.stringify(actual) !== JSON.stringify(wanted)) throw new Error(`${path} must contain exactly keys ${wanted.join(', ')}`);
}
function record(value, path) {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${path} must be a plain object`);
	return value;
}
function timestamp(value, path) {
	if (typeof value !== 'string' || Number.isNaN(new Date(value).getTime()) || new Date(value).toISOString() !== value) throw new Error(`${path} must be a canonical UTC timestamp`);
	return value;
}
function sha1(value, path) {
	if (typeof value !== 'string' || !/^[0-9a-f]{40}$/u.test(value)) throw new Error(`${path} must be a lowercase Git SHA`);
	return value;
}
function sha256Value(value, path) {
	if (typeof value !== 'string' || !/^[0-9a-f]{64}$/u.test(value)) throw new Error(`${path} must be a lowercase SHA-256`);
	return value;
}
function nonEmpty(value, path) {
	if (typeof value !== 'string' || value.trim() === '') throw new Error(`${path} must be a non-empty string`);
	return value;
}
function compareText(left, right) { return left < right ? -1 : left > right ? 1 : 0; }
function sha256(value) { return createHash('sha256').update(value, 'utf8').digest('hex'); }
function resolvePath(root, value) { return isAbsolute(value) ? resolve(value) : resolve(root, value); }
function resolveCachePath(root, value, option) {
	if (isAbsolute(value)) throw new Error(`${option} must be repository-relative`);
	const absolutePath = resolve(root, value);
	const repositoryRelative = relative(root, absolutePath).replaceAll('\\', '/');
	if (!(repositoryRelative === '.cache' || repositoryRelative.startsWith('.cache/'))) throw new Error(`${option} must be inside .cache`);
	if (!repositoryRelative.endsWith('.json')) throw new Error(`${option} must end in .json`);
	return { absolutePath, repositoryRelative };
}

const directExecution = process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (directExecution) {
	try {
		await main();
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	}
}