import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const SELFHOST_RELEASE_GATE_SCHEMA_VERSION = 1;
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
		claim: 'selfhost-stable-release-gate',
		productionEligible: false,
		checkedAt,
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
	if (exitCode !== 0) {
		return {
			id,
			status: 'fail',
			passed: false,
			exitCode,
			stdoutSha256: sha256(stdout),
			stderrSha256: sha256(stderr),
			reason: nonEmptyOr(stderr.trim(), `${id} exited with status ${exitCode}.`),
		};
	}
	let evidence;
	try {
		evidence = JSON.parse(stdout);
	} catch (error) {
		return {
			id,
			status: 'fail',
			passed: false,
			exitCode,
			stdoutSha256: sha256(stdout),
			stderrSha256: sha256(stderr),
			reason: `${id} did not emit exactly one JSON evidence value: ${error instanceof Error ? error.message : String(error)}`,
		};
	}
	const semantic = validateStepEvidence(id, evidence);
	return {
		id,
		status: semantic.passed ? 'pass' : 'fail',
		passed: semantic.passed,
		exitCode,
		stdoutSha256: sha256(stdout),
		stderrSha256: sha256(stderr),
		evidenceSha256: sha256(JSON.stringify(evidence)),
		...(semantic.passed ? {} : { reason: semantic.reason }),
	};
}

export function validateStepEvidence(id, value) {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		return { passed: false, reason: `${id} evidence must be an object.` };
	}
	if (id === 'seed-verify') {
		return value.schemaVersion === 1 && value.passed === true && isSha256(value.sha256)
			? { passed: true }
			: { passed: false, reason: 'Fixed Seed verification evidence is not successful.' };
	}
	if (id === 'fixed-seed-bootstrap') {
		const seed = value.seed;
		const stage1 = value.stage1;
		const stage2 = value.stage2;
		const passed = value.schemaVersion === 1
			&& value.claim === 'fixed-seed-stage1-stage2-bootstrap'
			&& value.productionEligible === false
			&& value.status === 'match'
			&& seed?.verified === true
			&& isSha256(seed?.artifactSha256)
			&& value.stage0Source === 'fixed-seed-artifact'
			&& isSha256(stage1?.sha256)
			&& isSha256(stage2?.sha256)
			&& value.equivalent === true
			&& stage1.sha256 === stage2.sha256;
		return passed
			? { passed: true }
			: { passed: false, reason: 'Stage 1/2 evidence does not prove execution from the verified fixed Seed artifact.' };
	}
	if (id === 'clean-bootstrap') {
		const passed = value.schemaVersion === 1
			&& value.claim === 'selfhost-clean-bootstrap'
			&& value.status === 'pass'
			&& value.workingTreeClean === true
			&& value.networkMode === 'offline'
			&& value.seed?.verified === true
			&& value.bootstrap?.equivalent === true;
		return passed ? { passed: true } : { passed: false, reason: 'Clean/offline bootstrap evidence is not successful.' };
	}
	if (id === 'legacy-rollback') {
		const passed = value.schemaVersion === 1
			&& value.claim === 'selfhost-legacy-rollback-smoke'
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
		'Runs the fail-closed self-host release proofs in order: fixed Seed verification, fixed-Seed Stage 1/2 bootstrap,',
		'clean/offline bootstrap, and clean Legacy rollback. This command is not wired into the stable release gate until',
		'all four operational runners exist on main.',
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
		console.log(`Self-host stable release gate: ${report.passed ? 'PASS' : 'FAIL'}`);
		console.log(`Evidence: ${output.repositoryRelative}`);
	}
	if (!report.passed) throw new Error(`Self-host stable release gate failed. Evidence: ${output.repositoryRelative}`);
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

function canonicalTimestamp(value) {
	const date = value instanceof Date ? value : new Date(value);
	if (Number.isNaN(date.getTime())) throw new Error('self-host release gate clock returned an invalid timestamp');
	return date.toISOString();
}
function sha256(value) { return createHash('sha256').update(value, 'utf8').digest('hex'); }
function isSha256(value) { return typeof value === 'string' && /^[0-9a-f]{64}$/u.test(value); }
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
