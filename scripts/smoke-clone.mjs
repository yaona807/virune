import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const root = resolve('.');
const cli = join(root, 'packages/cli/dist/src/main.js');
const temporaryRoot = join(root, '.test-tmp');
await mkdir(temporaryRoot, { recursive: true });
const workspace = await mkdtemp(join(temporaryRoot, 'clone-smoke-'));
try {
	execFileSync(process.execPath, [cli, '--version'], { stdio: 'inherit', cwd: root });
	execFileSync(process.execPath, [cli, 'check', root], { stdio: 'inherit', cwd: root });
	execFileSync(process.execPath, [cli, 'run', root], { stdio: 'inherit', cwd: root });
	const project = join(workspace, 'app');
	execFileSync(process.execPath, [cli, 'init', project], { stdio: 'inherit', cwd: root });
	execFileSync(process.execPath, [cli, 'check', project], { stdio: 'inherit', cwd: root });
	execFileSync(process.execPath, [cli, 'run', project], { stdio: 'inherit', cwd: root });
	execFileSync(process.execPath, [cli, 'run', join(root, 'examples/user-directory'), '--', 'Alice', 'Bob'], { stdio: 'inherit', cwd: root });
} finally {
	await rm(workspace, {
		recursive: true,
		force: true,
		maxRetries: process.platform === 'win32' ? 10 : 3,
		retryDelay: 200,
	});
}
