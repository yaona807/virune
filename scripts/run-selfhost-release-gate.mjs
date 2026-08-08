import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const SELFHOST_RELEASE_GATE_SCHEMA_VERSION = 2;
export const DEFAULT_SELFHOST_RELEASE_OUTPUT = '.cache/release/selfhost-release-gate.json';
export const REQUIRED_SELFHOST_RELEASE_STEPS = Object.freeze([
	Object.freeze({ id: 'seed-verify', command: Object.freeze(['node', 'scripts/verify-selfhost-seed.mjs', '--json']) }),
	Object.freeze({ id: 'fixed-seed-bootstrap', command: Object.freeze(['node', 'scripts/run-selfhost-fixed-seed-bootstrap.mjs', '--json']) }),
	Object.freeze({ id: 'clean-bootstrap', command: Object.freeze(['node', 'scripts/run-selfhost-clean-bootstrap.mjs', '--json']) }),
	Object.freeze({ id: 'legacy-rollback', command: Object.freeze(['node', 'scripts/run-selfhost-rollback-smoke.mjs', '--json']) }),
]);

export function parseArguments(argumentsList) {
	let help = false;
	let json = false;
	let output = DEFAULT_SELFHOST_RELEASE_OUTPUT;
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
		if (!argument.startsWith('--output=')) throw new Error(`Unknown argument: ${argument}`);
		if (seen.has('output')) throw new Error('Duplicate option: --output');
		seen.add('output');
		output = nonEmpty(argument.slice('--output='.length), '--output');
	}
	if (help && seen.size > 1) throw new Error('--help cannot be combined with other options');
	return { help, json, output };
}

export function resolveCachePath(repositoryRoot, value) {
	if (isAbsolute(value)) throw new Error('--output must be repository-relative');
	const absolutePath = resolve(repositoryRoot, value);
	const repositoryRelative = relative(repositoryRoot, absolutePath);
	if (
		repositoryRelative === ''
		|| repositoryRelative === '..'
		|| repositoryRelative.startsWith(`..${sep}`)
		|| isAbsolute(repositoryRelative)
	) throw new Error('--output must stay inside the repository');
	if (!(repositoryRelative === '.cache' || repositoryRelative.startsWith(`.cache${sep}`))) {
		throw new Error('--output must be inside .cache');
	}
	if (!repositoryRelative.endsWith('.json')) throw new Error('--output must end in .json');
	return { absolutePath, repositoryRelative: repositoryRelative.replaceAll('\\', '/') };
}

export async function runSelfhostReleaseGate({
	repositoryRoot,
	execute = executeCommand,
	steps = REQUIRED_SELFHOST_RELEASE_STEPS,
	now = () => new Date(),
} = {}) {
	const checkedAt = canonicalTimestamp(now());
	const results = [];
	let failed = false;
	for (const step of steps) {
		if (failed) {
			results.push({ id: step.id, status: 'skipped', passed: false, reason: 'A previous required self-host release step failed.' });
			continue;
		}
		const execution = await execute(step.command, repositoryRoot);
		const record = createStepRecord(step.id, execution);
		results.push(record);
		if (!record.passed) failed = true;
	}
	const report = {
		schemaVersion: SELFHOST_RELEASE_GATE_SCHEMA_VERSION,
		claim: 'selfhost-stable-release-gate-core',
		productionEligible: false,
		checkedAt,
		policy: {
			version: 1,
			failClosed: true,
			requiredSteps: steps.map(step => step.id),
			fixedPoint: { from: 'stage2', to: 'stage3', requireEquivalent: true, requireShaEquality: true, differenceCount: 0 },
			cleanBootstrap: { dependencyMode: 'offline' },
			productionDefaultChange: false,
		},
		steps: results,
		passed: results.length === steps.length && results.every(step => step.passed),
	};
	const serialized = JSON.stringify(report);
	return { ...report, evidenceSha256: sha256(serialized) };
}

export function createStepRecord(id, execution) {
	const exitCode = Number.isSafeInteger(execution?.status) ? execution.status : 1;
	const stdout = typeof execution?.stdout === 'string' ? execution.stdout : '';
	const stderr = typeof execution?.stderr === 'string' ? execution.stderr : '';
	const base = {
		id,
		exitCode,
		stdoutSha256: sha256(stdout),
		stderrSha256: sha256(stderr),
	};
	if (exitCode !== 0) {
		return {
			...base,
			status: 'fail',
			passed: false,
			reason: nonEmptyOr(stderr.trim(), `${id} exited with status ${exitCode}.`),
		};
	}
	const parsed = parseStepEvidence(id, stdout);
	if (!parsed.passed) {
		return { ...base, status: 'fail', passed: false, reason: parsed.reason };
	}
	const semantic = validateStepEvidence(id, parsed.evidence);
	return {
		...base,
		status: semantic.passed ? 'pass' : 'fail',
		passed: semantic.passed,
		evidenceSha256: sha256(JSON.stringify(parsed.evidence)),
		...(semantic.passed ? {} : { reason: semantic.reason }),
	};
}

export function parseStepEvidence(id, stdout) {
	const trimmed = typeof stdout === 'string' ? stdout.trim() : '';
	if (trimmed === '') return { passed: false, reason: `${id} emitted no JSON evidence.` };
	const direct = parseJsonObject(trimmed);
	if (direct !== null) return { passed: true, evidence: direct };
	if (id !== 'fixed-seed-bootstrap') {
		return { passed: false, reason: `${id} did not emit exactly one JSON evidence value.` };
	}

	const candidates = [];
	for (const line of trimmed.split(/\r?\n/u).map(value => value.trim()).filter(Boolean)) {
		if (line.startsWith('FIXED_SEED_PROGRESS ')) continue;
		const value = parseJsonObject(line);
		if (value === null) {
			return { passed: false, reason: 'fixed-seed-bootstrap emitted an unknown non-progress stdout frame.' };
		}
		if (value.schemaVersion === 2 && value.claim === 'fixed-seed-bootstrap-fixed-point') candidates.push(value);
		else return { passed: false, reason: 'fixed-seed-bootstrap emitted an unknown JSON evidence frame.' };
	}
	if (candidates.length !== 1) {
		return { passed: false, reason: `fixed-seed-bootstrap emitted ${candidates.length} matching evidence values; exactly one is required.` };
	}
	return { passed: true, evidence: candidates[0] };
}

export function validateStepEvidence(id, value) {
	if (!isObject(value)) return { passed: false, reason: `${id} evidence must be an object.` };
	if (id === 'seed-verify') {
		return value.schemaVersion === 1 && value.passed === true && isSha256(value.sha256)
			? { passed: true }
			: { passed: false, reason: 'Fixed Seed verification evidence is not successful.' };
	}
	if (id === 'fixed-seed-bootstrap') {
		const seed = value.seed;
		const stage1 = value.stage1;
		const stage2 = value.stage2;
		const stage3 = value.stage3;
		const transition = value.transition;
		const fixedPoint = value.fixedPoint;
		const passed = value.schemaVersion === 2
			&& value.claim === 'fixed-seed-bootstrap-fixed-point'
			&& value.productionEligible === false
			&& value.status === 'match'
			&& value.stage0Source === 'fixed-seed-artifact'
			&& seed?.verified === true
			&& isSha256(seed?.artifactSha256)
			&& isSha256(seed?.manifestSha256)
			&& isSha256(stage1?.sha256)
			&& isSha256(stage2?.sha256)
			&& isSha256(stage3?.sha256)
			&& transition?.from === 'stage1'
			&& transition?.to === 'stage2'
			&& nonNegativeInteger(transition?.differenceCount)
			&& fixedPoint?.from === 'stage2'
			&& fixedPoint?.to === 'stage3'
			&& fixedPoint?.attempted === true
			&& fixedPoint?.equivalent === true
			&& fixedPoint?.differenceCount === 0
			&& fixedPoint?.error === null
			&& stage2.sha256 === stage3.sha256
			&& value.equivalent === true;
		return passed
			? { passed: true }
			: { passed: false, reason: 'Fixed Seed evidence does not prove the exact Stage 2/Stage 3 fixed point.' };
	}
	if (id === 'clean-bootstrap') {
		const seed = value.seed;
		const bootstrap = value.bootstrap;
		const environment = value.environment;
		const passed = value.schemaVersion === 2
			&& value.claim === 'selfhost-clean-bootstrap-fixed-point'
			&& value.productionEligible === false
			&& value.status === 'pass'
			&& value.passed === true
			&& value.workingTreeClean === true
			&& value.dependencyMode === 'offline'
			&& isSha256(value.candidateSha256)
			&& isSha256(value.lockfileSha256)
			&& seed?.verified === true
			&& isSha256(seed?.manifestSha256)
			&& isSha256(seed?.artifactSha256)
			&& isSha256(bootstrap?.seedSha256)
			&& bootstrap.seedSha256 === seed.artifactSha256
			&& isSha256(bootstrap?.stage1Sha256)
			&& isSha256(bootstrap?.stage2Sha256)
			&& isSha256(bootstrap?.stage3Sha256)
			&& bootstrap.fixedPointEquivalent === true
			&& bootstrap.fixedPointDifferenceCount === 0
			&& bootstrap.stage2Sha256 === bootstrap.stage3Sha256
			&& value.candidateSha256 === bootstrap.stage3Sha256
			&& (environment?.profile === 'baseline' || environment?.profile === 'perturbed')
			&& nonEmptyString(environment?.timezone)
			&& nonEmptyString(environment?.locale)
			&& nonEmptyString(environment?.homeVariant)
			&& nonEmptyString(environment?.tempVariant);
		return passed ? { passed: true } : { passed: false, reason: 'Clean dependency-offline fixed-point evidence is not successful.' };
	}
	if (id === 'legacy-rollback') {
		const passed = value.schemaVersion === 1
			&& value.claim === 'selfhost-legacy-rollback-smoke'
			&& value.productionEligible === false
			&& value.status === 'pass'
			&& value.workingTreeClean === true
			&& value.selection === 'legacy'
			&& value.rollbackRequired === true
			&& value.candidateAccessed === false;
		return passed ? { passed: true } : { passed: false, reason: 'Legacy rollback evidence is not successful.' };
	}
	return { passed: false, reason: `Unknown self-host release step: ${id}` };
}

export function helpText() {
	return [
		'Usage: node scripts/run-selfhost-release-gate.mjs [--json] [--output=<.cache/file.json>]',
		'',
		'Runs fail-closed self-host release proof inputs in order: fixed Seed verification, fixed-Seed Stage 2/3 fixed point,',
		'clean dependency-offline fixed point, and clean Legacy rollback. Stage 1/2 differences are transition evidence.',
		'This evidence-only core never changes the production compiler default and always reports productionEligible: false.',
	].join('\n');
}

export async function main(argumentsList = process.argv.slice(2), injected = {}) {
	const options = parseArguments(argumentsList);
	if (options.help) {
		console.log(helpText());
		return null;
	}
	const repositoryRoot = resolve(injected.repositoryRoot ?? fileURLToPath(new URL('..', import.meta.url)));
	const output = resolveCachePath(repositoryRoot, options.output);
	const report = await runSelfhostReleaseGate({
		repositoryRoot,
		...(injected.execute === undefined ? {} : { execute: injected.execute }),
		...(injected.steps === undefined ? {} : { steps: injected.steps }),
		...(injected.now === undefined ? {} : { now: injected.now }),
	});
	await mkdir(dirname(output.absolutePath), { recursive: true });
	const encoded = `${JSON.stringify(report)}\n`;
	await writeFile(output.absolutePath, encoded, 'utf8');
	if (options.json) process.stdout.write(encoded);
	else {
		for (const step of report.steps) console.log(`[selfhost-release] ${step.status.toUpperCase()} ${step.id}`);
		console.log(`Self-host stable release gate core: ${report.passed ? 'PASS' : 'FAIL'}`);
		console.log(`Evidence: ${output.repositoryRelative}`);
	}
	if (!report.passed) throw new Error(`Self-host stable release gate core failed. Evidence: ${output.repositoryRelative}`);
	return report;
}

function executeCommand(command, cwd) {
	const executable = process.platform === 'win32' && command[0] === 'npm' ? 'npm.cmd' : command[0];
	const result = spawnSync(executable, command.slice(1), {
		cwd,
		encoding: 'utf8',
		windowsHide: true,
		maxBuffer: 64 * 1024 * 1024,
	});
	if (result.error !== undefined) {
		return { status: 1, stdout: result.stdout ?? '', stderr: `${result.stderr ?? ''}\n${result.error.message}`.trim() };
	}
	return { status: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

function parseJsonObject(value) {
	try {
		const parsed = JSON.parse(value);
		return isObject(parsed) ? parsed : null;
	} catch {
		return null;
	}
}
function canonicalTimestamp(value) {
	const date = value instanceof Date ? value : new Date(value);
	if (Number.isNaN(date.getTime())) throw new Error('self-host release gate clock returned an invalid timestamp');
	return date.toISOString();
}
function sha256(value) { return createHash('sha256').update(value, 'utf8').digest('hex'); }
function isObject(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function isSha256(value) { return typeof value === 'string' && /^[0-9a-f]{64}$/u.test(value); }
function nonNegativeInteger(value) { return Number.isSafeInteger(value) && value >= 0; }
function nonEmptyString(value) { return typeof value === 'string' && value.length > 0; }
function nonEmpty(value, name) {
	if (typeof value !== 'string' || value.trim() === '') throw new Error(`${name} must be a non-empty string`);
	return value.trim();
}
function nonEmptyOr(value, fallback) { return typeof value === 'string' && value.length > 0 ? value : fallback; }

const directExecution = process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (directExecution) {
	try { await main(); }
	catch (error) {
		console.error(`SELFHOST_RELEASE_GATE_ERROR ${error instanceof Error ? error.message : String(error)}`);
		process.exitCode = 1;
	}
}
