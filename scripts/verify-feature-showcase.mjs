import { spawn } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const cli = join(repositoryRoot, 'packages/cli/dist/src/main.js');
const showcaseRoot = join(repositoryRoot, 'examples/feature-showcase');
const nodeProject = join(showcaseRoot, 'node');
const browserProject = join(showcaseRoot, 'browser');
const cacheRoot = join(repositoryRoot, '.cache');

await mkdir(cacheRoot, { recursive: true });

await runCli('Node format', ['fmt', '--check', nodeProject]);
await runCli('Node check', ['check', nodeProject]);
await runCli('Node tests', ['test', nodeProject]);
await runCli('Node API snapshot', ['api', nodeProject, '--out', join(nodeProject, 'virune.api.json'), '--check']);
await runCli('Node build', ['build', nodeProject]);
await runCli('Node run', ['run', nodeProject, '--', 'Alice', 'Bob']);
await verifyBindingDrift();
await runCli('TypeScript adapter', ['interop', 'check', nodeProject]);
await verifyUnsafeFixture();

await runCli('Browser format', ['fmt', '--check', browserProject]);
await runCli('Browser check', ['check', browserProject]);
await runCli('Browser build', ['build', browserProject]);

console.log('Feature showcase verification completed successfully.');

async function verifyBindingDrift() {
	const temporaryRoot = await mkdtemp(join(cacheRoot, 'feature-showcase-bind-'));
	try {
		const generated = join(temporaryRoot, 'node-os.virune');
		await runCli('Safe binding generation', [
			'bind',
			join(nodeProject, 'types/node-os-showcase.d.ts'),
			'--module', 'node:os',
			'--out', generated,
		]);
		const expected = join(nodeProject, 'src/ffi/node-os.virune');
		const [generatedText, expectedText] = await Promise.all([
			readFile(generated, 'utf8'),
			readFile(expected, 'utf8'),
		]);
		if (generatedText !== expectedText) {
			throw new Error(`Safe binding drift detected: regenerate ${relativeDisplay(expected)} with the documented virune bind command.`);
		}
	} finally {
		await rm(temporaryRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
	}
}

async function verifyUnsafeFixture() {
	const temporaryRoot = await mkdtemp(join(cacheRoot, 'feature-showcase-unsafe-'));
	const stagedProject = join(temporaryRoot, 'node');
	try {
		await cp(nodeProject, stagedProject, { recursive: true });
		const fixture = join(stagedProject, 'src/ffi/unsafe-hostname.virune.example');
		const stagedSource = join(stagedProject, 'src/ffi/unsafe-hostname.virune');
		await writeFile(stagedSource, await readFile(fixture, 'utf8'), 'utf8');
		await runCli('Unsafe FFI project boundary', ['check', stagedProject]);
	} finally {
		await rm(temporaryRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
	}
}

async function runCli(label, args) {
	process.stdout.write(`\n[feature-showcase] ${label}\n`);
	await run(process.execPath, [cli, ...args]);
}

async function run(command, args) {
	await new Promise((resolveRun, rejectRun) => {
		const child = spawn(command, args, {
			cwd: repositoryRoot,
			stdio: 'inherit',
			env: process.env,
		});
		child.once('error', rejectRun);
		child.once('exit', (code, signal) => {
			if (code === 0) resolveRun();
			else rejectRun(new Error(`${basename(command)} exited with ${code === null ? `signal ${signal ?? 'unknown'}` : `code ${code}`}`));
		});
	});
}

function relativeDisplay(path) {
	return path.startsWith(`${repositoryRoot}/`) ? path.slice(repositoryRoot.length + 1) : path;
}
