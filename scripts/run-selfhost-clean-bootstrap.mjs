import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { verifySelfhostSeed } from './verify-selfhost-seed.mjs';

export const CLEAN_BOOTSTRAP_RUNNER_SCHEMA_VERSION = 2;
export const DEFAULT_CLEAN_BOOTSTRAP_OUTPUT = '.cache/selfhost/clean-bootstrap.json';
export const DEFAULT_CLEAN_BOOTSTRAP_ROOT = '.cache/selfhost/clean-bootstrap';
export const DEFAULT_ENVIRONMENT_PROFILE = 'baseline';
const zeroSha = '0'.repeat(64);
const environmentProfiles = new Set(['baseline', 'perturbed']);

export function parseArguments(argumentsList) {
	let help = false;
	let json = false;
	let artifact = null;
	let output = DEFAULT_CLEAN_BOOTSTRAP_OUTPUT;
	let workingRoot = DEFAULT_CLEAN_BOOTSTRAP_ROOT;
	let environmentProfile = DEFAULT_ENVIRONMENT_PROFILE;
	const seen = new Set();
	for (const argument of argumentsList) {
		if (argument === '--help' || argument === '--json') {
			const name = argument.slice(2);
			if (seen.has(name)) throw new Error(`Duplicate option: ${argument}`);
			seen.add(name);
			if (name === 'help') help = true;
			else json = true;
			continue;
		}
		const option = ['artifact', 'output', 'working-root', 'environment-profile']
			.find(name => argument.startsWith(`--${name}=`));
		if (option === undefined) throw new Error(`Unknown argument: ${argument}`);
		if (seen.has(option)) throw new Error(`Duplicate option: --${option}`);
		seen.add(option);
		const value = nonEmpty(argument.slice(option.length + 3), `--${option}`);
		if (option === 'artifact') artifact = value;
		else if (option === 'output') output = value;
		else if (option === 'working-root') workingRoot = value;
		else environmentProfile = requireEnvironmentProfile(value);
	}
	if (help && seen.size > 1) throw new Error('--help cannot be combined with other options');
	return { help, json, artifact, output, workingRoot, environmentProfile };
}

export function commandEvidence(name, execution) {
	return {
		name,
		exitCode: Number.isSafeInteger(execution.status) && execution.status >= 0 ? execution.status : 1,
		stdoutSha256: sha256(execution.stdout ?? ''),
		stderrSha256: sha256(execution.stderr ?? ''),
	};
}

export function createCleanBootstrapInput({
	repositoryCommit,
	checkedAt,
	workingTreeClean,
	lockfileSha256,
	manifestSha256,
	artifactSha256,
	seedExecution,
	bootstrapExecution,
	bootstrapEvidence,
	environment,
	commands,
}) {
	const seedEvidence = parseJsonObject(seedExecution.stdout);
	const seedVerified = seedExecution.status === 0
		&& seedEvidence?.passed === true
		&& seedEvidence.sha256 === artifactSha256;
	const bootstrap = bootstrapEvidence ?? parseJsonObject(bootstrapExecution.stdout);
	const stage1Sha256 = validSha(bootstrap?.stage1?.sha256) ? bootstrap.stage1.sha256 : zeroSha;
	const stage2Sha256 = validSha(bootstrap?.stage2?.sha256) ? bootstrap.stage2.sha256 : zeroSha;
	const stage3Sha256 = validSha(bootstrap?.stage3?.sha256) ? bootstrap.stage3.sha256 : zeroSha;
	const bootstrapSeedSha256 = validSha(bootstrap?.seed?.artifactSha256) ? bootstrap.seed.artifactSha256 : artifactSha256;
	const fixedPointEquivalent = bootstrapExecution.status === 0
		&& bootstrap?.status === 'match'
		&& bootstrap?.fixedPoint?.equivalent === true;
	const fixedPointDifferenceCount = Number.isSafeInteger(bootstrap?.fixedPoint?.differenceCount)
		&& bootstrap.fixedPoint.differenceCount >= 0
		? bootstrap.fixedPoint.differenceCount
		: Number.MAX_SAFE_INTEGER;
	return {
		version: 2,
		candidateSha256: stage3Sha256,
		repositoryCommit,
		checkedAt,
		workingTreeClean,
		dependencyMode: 'offline',
		environment,
		lockfileSha256,
		seed: {
			manifestSha256,
			artifactSha256,
			verified: seedVerified,
		},
		bootstrap: {
			seedSha256: bootstrapSeedSha256,
			stage1Sha256,
			stage2Sha256,
			stage3Sha256,
			fixedPointEquivalent,
			fixedPointDifferenceCount,
		},
		commands,
	};
}

export function wrapCleanBootstrapEvidence(result) {
	return {
		schemaVersion: CLEAN_BOOTSTRAP_RUNNER_SCHEMA_VERSION,
		claim: 'selfhost-clean-bootstrap-fixed-point',
		productionEligible: false,
		status: result.report.status,
		passed: result.report.status === 'pass',
		candidateSha256: result.report.candidateSha256,
		repositoryCommit: result.report.repositoryCommit,
		checkedAt: result.report.checkedAt,
		workingTreeClean: result.report.workingTreeClean,
		dependencyMode: result.report.dependencyMode,
		environment: result.report.environment,
		lockfileSha256: result.report.lockfileSha256,
		seed: result.report.seed,
		bootstrap: result.report.bootstrap,
		commands: result.report.commands,
		failures: result.report.failures,
		evidenceSha256: result.sha256,
	};
}

export async function runCleanBootstrap({
	repositoryRoot,
	artifactPath,
	workingRoot,
	environmentProfile = DEFAULT_ENVIRONMENT_PROFILE,
	now = () => new Date(),
	execute = executeCommand,
	seedVerifier = verifySelfhostSeed,
	evaluatorLoader = loadCleanBootstrapEvaluator,
}) {
	const profile = requireEnvironmentProfile(environmentProfile);
	const repositoryCommit = requireGitValue(execute(['git', 'rev-parse', 'HEAD'], repositoryRoot), 'repository commit');
	if (!/^[0-9a-f]{40}$/u.test(repositoryCommit)) throw new Error('Repository HEAD must be a full lowercase Git SHA');
	const lockfileBytes = await readFile(resolve(repositoryRoot, 'package-lock.json'));
	const manifestBytes = await readFile(resolve(repositoryRoot, '.github/self-hosting/stage0-seed.json'));
	const manifest = JSON.parse(manifestBytes.toString('utf8'));
	const verified = await seedVerifier({
		root: repositoryRoot,
		...(artifactPath === null ? {} : { artifactPath }),
	});
	if (verified.passed !== true || verified.sha256 !== manifest.artifact.sha256) {
		throw new Error('Source Seed provisioning did not verify the pinned artifact');
	}
	await mkdir(workingRoot, { recursive: true });
	const executionProfile = await prepareEnvironment(profile, workingRoot);
	const cloneRoot = await mkdtemp(join(workingRoot, 'clean-clone-'));
	try {
		const clone = execute(['git', 'clone', '--no-hardlinks', '--local', '--no-checkout', repositoryRoot, cloneRoot], repositoryRoot);
		requireSuccess(clone, 'Local clean clone');
		requireSuccess(execute(['git', 'checkout', '--detach', repositoryCommit], cloneRoot), 'Clean clone checkout');
		const artifactRelative = `.cache/selfhost-seed/${basename(verified.artifact)}`;
		const clonedArtifact = resolve(cloneRoot, artifactRelative);
		await mkdir(dirname(clonedArtifact), { recursive: true });
		await copyFile(verified.artifact, clonedArtifact);

		const install = executeOfflineInstall(cloneRoot, execute, executionProfile.variables);
		const seedExecution = install.status === 0
			? execute(
				['node', 'scripts/verify-selfhost-seed.mjs', `--artifact=${artifactRelative}`, '--json'],
				cloneRoot,
				executionProfile.variables,
			)
			: skippedExecution('install failed');
		const bootstrapExecution = seedExecution.status === 0
			? execute(
				['node', 'scripts/run-selfhost-fixed-seed-bootstrap.mjs', `--artifact=${artifactRelative}`, '--json'],
				cloneRoot,
				executionProfile.variables,
			)
			: skippedExecution('seed verification failed');
		const statusExecution = execute(['git', 'status', '--porcelain'], cloneRoot);
		requireSuccess(statusExecution, 'Clean checkout status');
		const workingTreeClean = statusExecution.stdout.trim() === '';
		const commands = [
			commandEvidence('install', install),
			commandEvidence('seed-verify', seedExecution),
			commandEvidence('bootstrap', bootstrapExecution),
		];
		const input = createCleanBootstrapInput({
			repositoryCommit,
			checkedAt: canonicalTimestamp(now()),
			workingTreeClean,
			lockfileSha256: sha256(lockfileBytes),
			manifestSha256: sha256(manifestBytes),
			artifactSha256: verified.sha256,
			seedExecution,
			bootstrapExecution,
			environment: executionProfile.evidence,
			commands,
		});
		if (install.status !== 0) {
			return createFallbackFailure(input, 'COMMAND_FAILED', '$.commands.install.exitCode', 'Offline install/build failed');
		}
		const evaluate = await evaluatorLoader(cloneRoot);
		return wrapCleanBootstrapEvidence(evaluate(input));
	} finally {
		await rm(cloneRoot, { recursive: true, force: true });
	}
}

export function executeOfflineInstall(cwd, execute = executeCommand, environment = offlineEnvironment()) {
	const install = execute(['npm', 'ci', '--offline', '--ignore-scripts'], cwd, environment);
	if (install.status !== 0) return install;
	const build = execute(['npm', 'run', 'build'], cwd, environment);
	return {
		status: build.status,
		stdout: `${install.stdout ?? ''}${build.stdout ?? ''}`,
		stderr: `${install.stderr ?? ''}${build.stderr ?? ''}`,
	};
}

export async function prepareEnvironment(profile, workingRoot) {
	const normalized = requireEnvironmentProfile(profile);
	const cachePath = process.env.npm_config_cache
		?? (process.env.HOME === undefined ? undefined : resolve(process.env.HOME, '.npm'));
	if (normalized === 'baseline') {
		return {
			evidence: {
				profile: 'baseline',
				timezone: 'UTC',
				locale: 'C.UTF-8',
				homeVariant: 'host-default',
				tempVariant: 'host-default',
			},
			variables: offlineEnvironment({
				TZ: 'UTC',
				LANG: 'C.UTF-8',
				LC_ALL: 'C.UTF-8',
			}),
		};
	}
	const profileRoot = resolve(workingRoot, 'environment-perturbed');
	const home = resolve(profileRoot, 'home');
	const temporary = resolve(profileRoot, 'tmp');
	await mkdir(home, { recursive: true });
	await mkdir(temporary, { recursive: true });
	return {
		evidence: {
			profile: 'perturbed',
			timezone: 'Asia/Tokyo',
			locale: 'C',
			homeVariant: 'isolated-home',
			tempVariant: 'isolated-temp',
		},
		variables: offlineEnvironment({
			HOME: home,
			USERPROFILE: home,
			TMPDIR: temporary,
			TMP: temporary,
			TEMP: temporary,
			TZ: 'Asia/Tokyo',
			LANG: 'C',
			LC_ALL: 'C',
			...(cachePath === undefined ? {} : { npm_config_cache: cachePath }),
		}),
	};
}

export async function loadCleanBootstrapEvaluator(cloneRoot) {
	const path = resolve(cloneRoot, 'packages/compiler/dist/src/selfhost/clean-bootstrap-evidence.js');
	const url = new URL(pathToFileURL(path).href);
	url.searchParams.set('clean-bootstrap', `${Date.now()}-${Math.random()}`);
	const module = await import(url.href);
	if (typeof module.evaluateCleanBootstrapEvidence !== 'function') throw new Error('Clean bootstrap evidence evaluator is unavailable');
	return module.evaluateCleanBootstrapEvidence;
}

export function helpText() {
	return [
		'Usage: node scripts/run-selfhost-clean-bootstrap.mjs [--json] [--artifact=<path>] [--output=<.cache/file.json>] [--working-root=<.cache/path>] [--environment-profile=<baseline|perturbed>]',
		'',
		'Creates a local clean clone at the current commit, forces dependency tooling into offline mode, verifies the pre-provisioned fixed Seed,',
		'runs the fixed-Seed bootstrap through Stage 3, requires the exact Stage 2/3 fixed point, and records the selected environment profile.',
		'This claim is dependency-offline; it does not claim OS-level network isolation.',
	].join('\n');
}

export async function main(argumentsList = process.argv.slice(2), injected = {}) {
	const options = parseArguments(argumentsList);
	if (options.help) {
		console.log(helpText());
		return null;
	}
	const repositoryRoot = resolve(injected.repositoryRoot ?? fileURLToPath(new URL('..', import.meta.url)));
	const output = resolveCachePath(repositoryRoot, options.output, '--output', '.json');
	const workingRoot = resolveCachePath(repositoryRoot, options.workingRoot, '--working-root').absolutePath;
	const artifactPath = options.artifact === null ? null : resolvePath(repositoryRoot, options.artifact);
	let evidence;
	try {
		evidence = await runCleanBootstrap({
			repositoryRoot,
			artifactPath,
			workingRoot,
			environmentProfile: options.environmentProfile,
			...(injected.now === undefined ? {} : { now: injected.now }),
			...(injected.execute === undefined ? {} : { execute: injected.execute }),
			...(injected.seedVerifier === undefined ? {} : { seedVerifier: injected.seedVerifier }),
			...(injected.evaluatorLoader === undefined ? {} : { evaluatorLoader: injected.evaluatorLoader }),
		});
	} catch (error) {
		evidence = {
			schemaVersion: CLEAN_BOOTSTRAP_RUNNER_SCHEMA_VERSION,
			claim: 'selfhost-clean-bootstrap-fixed-point',
			productionEligible: false,
			status: 'fail',
			passed: false,
			error: error instanceof Error ? error.message : String(error),
		};
	}
	await mkdir(dirname(output.absolutePath), { recursive: true });
	const encoded = `${JSON.stringify(evidence)}\n`;
	await writeFile(output.absolutePath, encoded, 'utf8');
	if (options.json) process.stdout.write(encoded);
	else {
		console.log(`Clean bootstrap: ${evidence.status.toUpperCase()}`);
		console.log(`Evidence: ${output.repositoryRelative}`);
	}
	if (evidence.status !== 'pass') throw new Error(`Clean bootstrap did not pass. Evidence: ${output.repositoryRelative}`);
	return evidence;
}

function createFallbackFailure(input, code, path, message) {
	return {
		schemaVersion: CLEAN_BOOTSTRAP_RUNNER_SCHEMA_VERSION,
		claim: 'selfhost-clean-bootstrap-fixed-point',
		productionEligible: false,
		status: 'fail',
		passed: false,
		candidateSha256: input.candidateSha256,
		repositoryCommit: input.repositoryCommit,
		checkedAt: input.checkedAt,
		workingTreeClean: input.workingTreeClean,
		dependencyMode: input.dependencyMode,
		environment: input.environment,
		lockfileSha256: input.lockfileSha256,
		seed: input.seed,
		bootstrap: input.bootstrap,
		commands: input.commands,
		failures: [{ code, path, message }],
		evidenceSha256: sha256(JSON.stringify(input)),
	};
}

function executeCommand(command, cwd, env = {}) {
	const executable = process.platform === 'win32' && command[0] === 'npm' ? 'npm.cmd' : command[0];
	const result = spawnSync(executable, command.slice(1), {
		cwd,
		encoding: 'utf8',
		windowsHide: true,
		maxBuffer: 64 * 1024 * 1024,
		env: { ...process.env, ...env },
	});
	if (result.error !== undefined) {
		return {
			status: 1,
			stdout: result.stdout ?? '',
			stderr: `${result.stderr ?? ''}\n${result.error.message}`.trim(),
		};
	}
	return { status: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

function offlineEnvironment(overrides = {}) {
	return {
		npm_config_offline: 'true',
		npm_config_audit: 'false',
		npm_config_fund: 'false',
		...overrides,
	};
}

function requireEnvironmentProfile(value) {
	if (!environmentProfiles.has(value)) throw new Error('--environment-profile must be baseline or perturbed');
	return value;
}
function skippedExecution(reason) { return { status: 1, stdout: '', stderr: `SKIPPED: ${reason}` }; }
function requireSuccess(result, label) { if (result.status !== 0) throw new Error(`${label} failed: ${(result.stderr || result.stdout).trim()}`); }
function requireGitValue(result, label) { requireSuccess(result, `Read ${label}`); return result.stdout.trim(); }
function parseJsonObject(value) {
	if (typeof value !== 'string' || value.trim() === '') return null;
	try {
		const parsed = JSON.parse(value);
		return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
	} catch {
		return null;
	}
}
function canonicalTimestamp(value) {
	const date = value instanceof Date ? value : new Date(value);
	if (Number.isNaN(date.getTime())) throw new Error('Clean bootstrap clock returned an invalid timestamp');
	return date.toISOString();
}
function resolveCachePath(repositoryRoot, value, option, extension = null) {
	if (isAbsolute(value)) throw new Error(`${option} must be repository-relative`);
	const absolutePath = resolve(repositoryRoot, value);
	const repositoryRelative = relative(repositoryRoot, absolutePath).replaceAll('\\', '/');
	if (repositoryRelative === '' || repositoryRelative === '..' || repositoryRelative.startsWith('../') || repositoryRelative.startsWith('/')) {
		throw new Error(`${option} must stay inside the repository`);
	}
	if (!(repositoryRelative === '.cache' || repositoryRelative.startsWith('.cache/'))) throw new Error(`${option} must be inside .cache`);
	if (extension !== null && !repositoryRelative.endsWith(extension)) throw new Error(`${option} must end in ${extension}`);
	return { absolutePath, repositoryRelative };
}
function resolvePath(root, value) { return isAbsolute(value) ? resolve(value) : resolve(root, value); }
function validSha(value) { return typeof value === 'string' && /^[0-9a-f]{64}$/u.test(value); }
function nonEmpty(value, name) { if (typeof value !== 'string' || value.trim() === '') throw new Error(`${name} must be a non-empty string`); return value.trim(); }
function sha256(value) { return createHash('sha256').update(value).digest('hex'); }

const directExecution = process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (directExecution) {
	try {
		await main();
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	}
}
