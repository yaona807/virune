import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const root = resolve('.');
const cli = join(root, 'packages/cli/dist/src/main.js');
const workspace = await mkdtemp(join(root, '.test-tmp/clone-smoke-'));
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
	await rm(workspace, { recursive: true, force: true });
}
