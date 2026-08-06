import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultOutputTailLength = 8 * 1024;
const defaultMaxBuffer = 16 * 1024 * 1024;

export function createSourceCloneSmokeSteps({ root, cli, workspace }) {
	const project = join(workspace, 'app');
	return [
		{ id: 'cli-version', cwd: root, arguments: [cli, '--version'] },
		{ id: 'repository-check', cwd: root, arguments: [cli, 'check', root] },
		{ id: 'repository-run', cwd: root, arguments: [cli, 'run', root] },
		{ id: 'project-init', cwd: root, arguments: [cli, 'init', project] },
		{ id: 'project-check', cwd: root, arguments: [cli, 'check', project] },
		{ id: 'project-run', cwd: root, arguments: [cli, 'run', project] },
		{
			id: 'example-user-directory',
			cwd: root,
			arguments: [cli, 'run', join(root, 'examples/user-directory'), '--', 'Alice', 'Bob'],
		},
	];
}

export async function runSourceCloneSmoke(options = {}) {
	const root = resolve(options.root ?? '.');
	const cli = options.cli ?? join(root, 'packages/cli/dist/src/main.js');
	const temporaryRoot = options.temporaryRoot ?? join(root, '.test-tmp');
	const evidencePath = options.evidencePath ?? join(root, '.cache/smoke-clone/evidence.json');
	const execute = options.execute ?? executeSourceCloneSmokeStep;
	const remove = options.remove ?? rm;
	const now = options.now ?? Date.now;
	const stdout = options.stdout ?? process.stdout;
	const stderr = options.stderr ?? process.stderr;
	const startedMs = now();

	await mkdir(temporaryRoot, { recursive: true });
	const workspace = await mkdtemp(join(temporaryRoot, 'clone-smoke-'));
	const steps = createSourceCloneSmokeSteps({ root, cli, workspace });
	const completedSteps = [];
	let failure = null;
	let cleanupError = null;

	try {
		for (const step of steps) {
			const stepStartedMs = now();
			const result = await execute(step);
			writeOutput(stdout, result.stdout);
			writeOutput(stderr, result.stderr);
			const stepEvidence = {
				id: step.id,
				durationMs: duration(stepStartedMs, now()),
			};
			if (result.error !== null || result.status !== 0) {
				failure = {
					step,
					result,
					stepEvidence,
				};
				break;
			}
			completedSteps.push(stepEvidence);
		}
	} finally {
		try {
			await remove(workspace, {
				recursive: true,
				force: true,
				maxRetries: process.platform === 'win32' ? 10 : 3,
				retryDelay: 200,
			});
		} catch (error) {
			cleanupError = errorMessage(error);
		}
	}

	const completedMs = now();
	const evidence = createSourceCloneSmokeEvidence({
		root,
		workspace,
		startedMs,
		completedMs,
		completedSteps,
		failure,
		cleanupError,
	});
	await mkdir(dirname(evidencePath), { recursive: true });
	await writeFile(evidencePath, `${JSON.stringify(evidence, null, '\t')}\n`, 'utf8');
	writeOutput(
		evidence.status === 'success' ? stdout : stderr,
		`SOURCE_CLONE_SMOKE_EVIDENCE ${JSON.stringify(evidence)}\n`,
	);

	if (evidence.status === 'failure') {
		const detail = evidence.failure?.error
			?? evidence.failure?.stderrTail
			?? evidence.failure?.stdoutTail
			?? 'unknown failure';
		throw new Error(`Source clone smoke failed at ${evidence.failedStep}: ${detail}`);
	}
	return evidence;
}

export function createSourceCloneSmokeEvidence({
	root,
	workspace,
	startedMs,
	completedMs,
	completedSteps,
	failure,
	cleanupError,
}) {
	const failedStep = failure?.step.id ?? (cleanupError === null ? null : 'cleanup');
	const result = failure?.result;
	return {
		schemaVersion: 1,
		claim: 'source-clone-smoke-evidence',
		status: failedStep === null ? 'success' : 'failure',
		platform: process.platform,
		nodeVersion: process.version,
		startedAt: timestamp(startedMs),
		completedAt: timestamp(completedMs),
		durationMs: duration(startedMs, completedMs),
		completedSteps,
		failedStep,
		failure: failedStep === null ? null : {
			command: failure === null ? null : {
				executable: 'node',
				arguments: failure.step.arguments.map(argument => portableValue(argument, root, workspace)),
				cwd: portableValue(failure.step.cwd, root, workspace),
			},
			exitCode: result?.status ?? null,
			signal: result?.signal ?? null,
			error: result?.error ?? cleanupError,
			stdoutTail: tail(result?.stdout ?? ''),
			stderrTail: tail(result?.stderr ?? ''),
			cleanupError,
		},
	};
}

export function executeSourceCloneSmokeStep(step) {
	const result = spawnSync(process.execPath, step.arguments, {
		cwd: step.cwd,
		encoding: 'utf8',
		maxBuffer: defaultMaxBuffer,
		windowsHide: true,
	});
	return {
		status: result.status,
		signal: result.signal,
		error: result.error === undefined ? null : result.error.message,
		stdout: result.stdout ?? '',
		stderr: result.stderr ?? '',
	};
}

function portableValue(value, root, workspace) {
	if (typeof value !== 'string') return String(value);
	for (const [prefix, marker] of [[workspace, '<workspace>'], [root, '<repo>']]) {
		if (value === prefix) return marker;
		if (value.startsWith(`${prefix}${sep}`)) {
			return `${marker}/${relative(prefix, value).replaceAll('\\', '/')}`;
		}
	}
	return value.replaceAll('\\', '/');
}

function tail(value, maximumLength = defaultOutputTailLength) {
	if (value === '') return null;
	return value.length <= maximumLength ? value : value.slice(-maximumLength);
}

function writeOutput(stream, value) {
	if (value !== undefined && value !== null && value !== '') stream.write(value);
}

function duration(startedMs, completedMs) {
	return Math.max(0, Math.round(completedMs - startedMs));
}

function timestamp(milliseconds) {
	return new Date(milliseconds).toISOString();
}

function errorMessage(error) {
	return error instanceof Error ? error.message : String(error);
}

async function main() {
	await runSourceCloneSmoke();
}

const entry = process.argv[1] === undefined ? undefined : resolve(process.argv[1]);
if (entry === fileURLToPath(import.meta.url)) await main();
