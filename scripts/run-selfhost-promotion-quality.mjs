import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PROMOTION_QUALITY_SCHEMA_VERSION = 1;
export const DEFAULT_PROMOTION_QUALITY_OUTPUT = '.cache/selfhost-promotion-observation/quality.json';

function command(argv, environment = {}) {
	return Object.freeze({ argv: Object.freeze(argv), environment: Object.freeze({ ...environment }) });
}

const browserCommand = engine => command(
	['node', '--test', '--test-timeout=120000', 'integration/dist/browser.test.js'],
	{
		VIRUNE_BROWSER_ENGINE: engine,
		VIRUNE_PLAYWRIGHT_MANAGED: 'true',
		VIRUNE_BROWSER_ARTIFACT_DIR: `.cache/selfhost-promotion-browser/${engine}`,
	},
);

export const PROMOTION_QUALITY_COMMANDS = Object.freeze([
	Object.freeze({ id: 'bootstrap-smoke', commands: Object.freeze([
		command(['node', 'packages/cli/dist/src/main.js', 'build', 'selfhost/mvp']),
		command(['node', 'packages/cli/dist/src/main.js', 'test', 'selfhost/mvp']),
	]) }),
	Object.freeze({ id: 'differential-smoke', commands: Object.freeze([
		command(['node', 'scripts/run-selfhost-differential.mjs', '--tag=smoke']),
	]) }),
	Object.freeze({ id: 'format-check', commands: Object.freeze([
		command(['node', 'packages/cli/dist/src/main.js', 'fmt', '--check', 'examples']),
		command(['node', 'packages/cli/dist/src/main.js', 'fmt', '--check', 'selfhost/mvp']),
	]) }),
	Object.freeze({ id: 'type-check', commands: Object.freeze([
		command(['npm', 'run', 'check']),
		command(['node', 'packages/cli/dist/src/main.js', 'check', 'selfhost/mvp']),
	]) }),
	Object.freeze({ id: 'unit-tests', commands: Object.freeze([
		command(['node', 'scripts/run-tests.mjs', '--exclude-browser']),
	]) }),
	Object.freeze({ id: 'binding-corpus', commands: Object.freeze([
		command(['node', '--expose-gc', 'scripts/run-binding-corpus.mjs']),
	]) }),
	Object.freeze({ id: 'browser-integration', commands: Object.freeze([
		browserCommand('chromium'),
		browserCommand('firefox'),
		browserCommand('webkit'),
	]) }),
	Object.freeze({ id: 'full-conformance', commands: Object.freeze([
		command(['node', 'packages/cli/dist/src/main.js', 'test-conformance', '.']),
	]) }),
	Object.freeze({ id: 'full-differential', commands: Object.freeze([
		command(['node', 'scripts/run-selfhost-project-differential.mjs', '--output=.cache/selfhost-promotion-project-differential']),
	]) }),
	Object.freeze({ id: 'fuzz-regression', commands: Object.freeze([
		command(['npm', 'run', 'test:fuzz']),
		command(['node', 'scripts/run-selfhost-semantic-differential-fuzz.mjs', '--seed=1396983345', '--iterations=64', '--output=.cache/selfhost-promotion-semantic-fuzz']),
	]) }),
]);

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));

export async function runSelfhostPromotionQuality({
	root = repositoryRoot,
	output = DEFAULT_PROMOTION_QUALITY_OUTPUT,
	execute = executeCommand,
} = {}) {
	await rm(resolve(root, '.cache/selfhost-promotion-project-differential'), { recursive: true, force: true });
	await rm(resolve(root, '.cache/selfhost-promotion-semantic-fuzz'), { recursive: true, force: true });
	await rm(resolve(root, '.cache/selfhost-promotion-browser'), { recursive: true, force: true });
	const evidence = [];
	for (const group of PROMOTION_QUALITY_COMMANDS) {
		const executions = [];
		let status = 'passed';
		for (const commandSpec of group.commands) {
			const result = await execute(commandSpec.argv, root, commandSpec.environment);
			const record = executionRecord(commandSpec, result);
			executions.push(record);
			if (record.infrastructureFailed) {
				status = 'infrastructure-failed';
				break;
			}
			if (!record.passed) {
				status = 'failed';
				break;
			}
		}
		const record = { version: 1, id: group.id, status, executions };
		const serialized = JSON.stringify(record);
		evidence.push({ ...record, sha256: sha256(serialized) });
	}
	const reportStatus = evidence.some(item => item.status === 'infrastructure-failed')
		? 'infrastructure-failed'
		: evidence.every(item => item.status === 'passed') ? 'passed' : 'failed';
	const report = {
		schemaVersion: PROMOTION_QUALITY_SCHEMA_VERSION,
		claim: 'required-selfhost-promotion-quality',
		productionEligible: false,
		status: reportStatus,
		evidence,
	};
	const serialized = JSON.stringify(report);
	const target = resolve(root, output);
	await mkdir(dirname(target), { recursive: true });
	await writeFile(target, serialized, 'utf8');
	if (report.status !== 'passed') process.exitCode = 1;
	return { report, serialized, evidenceSha256: sha256(serialized) };
}

function executionRecord(commandSpec, result) {
	const exitCode = Number.isSafeInteger(result?.status) ? result.status : null;
	const signal = typeof result?.signal === 'string' && result.signal.length > 0 ? result.signal : null;
	const error = typeof result?.error === 'string' && result.error.length > 0 ? result.error : null;
	const infrastructureFailed = exitCode === null || signal !== null || error !== null;
	const stdout = typeof result?.stdout === 'string' ? result.stdout : '';
	const stderr = typeof result?.stderr === 'string' ? result.stderr : '';
	return {
		command: commandSpec.argv,
		environment: Object.fromEntries(Object.entries(commandSpec.environment).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)),
		exitCode,
		signal,
		errorSha256: error === null ? null : sha256(error),
		infrastructureFailed,
		passed: !infrastructureFailed && exitCode === 0,
		stdoutSha256: sha256(stdout),
		stderrSha256: sha256(stderr),
	};
}

function executeCommand(argv, cwd, environment) {
	const [executable, ...args] = argv;
	const result = spawnSync(executable, args, {
		cwd,
		env: { ...process.env, ...environment },
		encoding: 'utf8',
		maxBuffer: 32 * 1024 * 1024,
		stdio: ['ignore', 'pipe', 'pipe'],
	});
	return {
		status: result.status,
		signal: result.signal,
		error: result.error?.message,
		stdout: result.stdout ?? '',
		stderr: result.stderr ?? '',
	};
}

function sha256(value) { return createHash('sha256').update(value).digest('hex'); }

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const result = await runSelfhostPromotionQuality();
	console.log(JSON.stringify({ status: result.report.status, evidenceSha256: result.evidenceSha256 }));
}
