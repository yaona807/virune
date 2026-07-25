import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const maximumFailureLogBytes = 16 * 1024 * 1024;

export async function runCiCommand({ id, command, reproduce, job = process.env.VIRUNE_CI_JOB ?? process.env.GITHUB_JOB ?? 'local', root = repositoryRoot }) {
	if (typeof id !== 'string' || id === '') throw new Error('A non-empty command id is required.');
	if (!Array.isArray(command) || command.length === 0) throw new Error('A command is required after --.');
	const startedAt = Date.now();
	const execution = await execute(command, root);
	const durationMs = Date.now() - startedAt;
	const safeJob = sanitize(job);
	const record = {
		schemaVersion: 1,
		job,
		id,
		command,
		reproduce: reproduce ?? renderCommand(command),
		status: execution.status,
		durationMs,
		startedAt: new Date(startedAt).toISOString(),
		completedAt: new Date().toISOString(),
		error: execution.error,
		failureLogTruncated: execution.truncated,
	};
	const timingPath = resolve(root, `.cache/ci-timings/${safeJob}.jsonl`);
	await mkdir(dirname(timingPath), { recursive: true });
	await appendFile(timingPath, `${JSON.stringify(record)}\n`, 'utf8');
	if (record.status !== 0) {
		const failureBase = resolve(root, `.cache/ci-failures/${safeJob}-${sanitize(id)}`);
		await mkdir(dirname(failureBase), { recursive: true });
		await writeFile(`${failureBase}.log`, `${execution.output}${execution.truncated ? '\n[output truncated after 16 MiB]\n' : ''}`, 'utf8');
		await writeFile(`${failureBase}.md`, [
			`# CI failure: ${job} / ${id}`,
			'',
			`- Exit status: ${record.status}`,
			`- Duration: ${durationMs} ms`,
			`- Reproduce: \`${record.reproduce.replaceAll('`', '\\`')}\``,
			`- Log: \`${failureBase.slice(root.length + 1).replaceAll('\\', '/').replace(/\.md$/u, '')}.log\``,
			...(record.error === null ? [] : [`- Spawn error: ${record.error}`]),
			...(execution.truncated ? ['- Output was truncated after 16 MiB.'] : []),
			'',
		].join('\n'), 'utf8');
		if (process.env.GITHUB_ACTIONS === 'true') {
			process.stdout.write(`::error title=${escapeAnnotation(`${job} / ${id}`)}::${escapeAnnotation(`Failed with status ${record.status}. Reproduce: ${record.reproduce}`)}\n`);
		}
	}
	return record;
}

async function execute(command, root) {
	return await new Promise(resolveExecution => {
		const child = spawn(command[0], command.slice(1), {
			cwd: root,
			env: process.env,
			shell: process.platform === 'win32',
			stdio: ['inherit', 'pipe', 'pipe'],
		});
		let output = '';
		let outputBytes = 0;
		let truncated = false;
		let spawnError = null;
		const capture = chunk => {
			const text = chunk.toString();
			const bytes = Buffer.byteLength(text);
			if (outputBytes < maximumFailureLogBytes) {
				const remaining = maximumFailureLogBytes - outputBytes;
				if (bytes <= remaining) output += text;
				else {
					output += Buffer.from(text).subarray(0, remaining).toString();
					truncated = true;
				}
			}
			else truncated = true;
			outputBytes += bytes;
		};
		child.stdout.on('data', chunk => { process.stdout.write(chunk); capture(chunk); });
		child.stderr.on('data', chunk => { process.stderr.write(chunk); capture(chunk); });
		child.once('error', error => {
			spawnError = error;
			process.stderr.write(`${error.stack ?? error.message}\n`);
		});
		child.once('close', code => resolveExecution({
			status: spawnError === null ? code ?? 1 : 1,
			error: spawnError?.message ?? null,
			output,
			truncated,
		}));
	});
}

export function renderCommand(command) {
	return command.map(argument => /^[A-Za-z0-9_./:@=-]+$/u.test(argument) ? argument : JSON.stringify(argument)).join(' ');
}

function sanitize(value) {
	return value.toLowerCase().replace(/[^a-z0-9_.-]+/gu, '-').replace(/^-+|-+$/gu, '') || 'unknown';
}

function escapeAnnotation(value) {
	return value.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A').replaceAll(':', '%3A').replaceAll(',', '%2C');
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
