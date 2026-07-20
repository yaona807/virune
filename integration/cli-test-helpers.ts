import { execFile } from 'node:child_process';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execute = promisify(execFile);
export const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const cli = join(repositoryRoot, 'packages/cli/dist/src/main.js');
const temporaryRoot = join(repositoryRoot, '.test-tmp');

export async function runCli(args: readonly string[], cwd = repositoryRoot): Promise<{ stdout: string; stderr: string }> {
	return execute(process.execPath, [cli, ...args], { cwd, encoding: 'utf8' });
}

export async function makeCliProject(): Promise<string> {
	await mkdir(temporaryRoot, { recursive: true });
	return mkdtemp(join(temporaryRoot, 'virune-cli-'));
}
