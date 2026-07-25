import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));

export async function runCiCommand({ id, command, reproduce, job = process.env.VIRUNE_CI_JOB ?? process.env.GITHUB_JOB ?? 'local', root = repositoryRoot }) {
	if (typeof id !== 'string' || id === '') throw new Error('A non-empty command id is required.');
	if (!Array.isArray(command) || command.length === 0) throw new Error('A command is required after --.');
	const startedAt = Date.now();
	const result = spawnSync(command[0], command.slice(1), {
		cwd: root,
		env: process.env,
		stdio: 'inherit',
		shell: process.platform === 'win32',
	});
	const status = result.error === undefined ? result.status ?? 1 : 1;
	const durationMs = Date.now() - startedAt;
	const safeJob = sanitize(job);
	const record = {
		schemaVersion: 1,
		job,
		id,
		command,
		reproduce: reproduce ?? renderCommand(command),
		status,
		durationMs,
		startedAt: new Date(startedAt).toISOString(),
		completedAt: new Date().toISOString(),
		error: result.error?.message ?? null,
	};
	const timingPath = resolve(root, `.cache/ci-timings/${safeJob}.jsonl`);
	await mkdir(dirname(timingPath), { recursive: true });
	await appendFile(timingPath, `${JSON.stringify(record)}\n`, 'utf8');
	if (status !== 0) {
		const failurePath = resolve(root, `.cache/ci-failures/${safeJob}-${sanitize(id)}.md`);
		await mkdir(dirname(failurePath), { recursive: true });
		await writeFile(failurePath, [
			`# CI failure: ${job} / ${id}`,
			'',
			`- Exit status: ${status}`,
			`- Duration: ${durationMs} ms`,
			`- Reproduce: \`${record.reproduce.replaceAll('`', '\\`')}\``,
			...(record.error === null ? [] : [`- Spawn error: ${record.error}`]),
			'',
		].join('\n'), 'utf8');
	}
	if (result.error !== undefined) process.stderr.write(`${result.error.stack ?? result.error.message}\n`);
	return record;
}

export function renderCommand(command) {
	return command.map(argument => /^[A-Za-z0-9_./:@=-]+$/u.test(argument) ? argument : JSON.stringify(argument)).join(' ');
}

function sanitize(value) {
	return value.toLowerCase().replace(/[^a-z0-9_.-]+/gu, '-').replace(/^-+|-+$/gu, '') || 'unknown';
}

function parseArguments(argumentsList) {
	const separator = argumentsList.indexOf('--');
	if (separator === -1) throw new Error('Separate wrapper options and the command with --.');
	const options = argumentsList.slice(0, separator);
	const command = argumentsList.slice(separator + 1);
	const parsed = { command };
	for (let index = 0; index < options.length; index++) {
		const option = options[index];
		if (option === '--id') parsed.id = options[++index];
		else if (option === '--reproduce') parsed.reproduce = options[++index];
		else if (option === '--job') parsed.job = options[++index];
		else throw new Error(`Unknown option: ${option}`);
	}
	return parsed;
}

async function main() {
	const record = await runCiCommand(parseArguments(process.argv.slice(2)));
	process.exitCode = record.status;
}

const entry = process.argv[1] === undefined ? undefined : resolve(process.argv[1]);
if (entry === fileURLToPath(import.meta.url)) await main();
