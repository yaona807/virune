import { spawn } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const cli = join(repositoryRoot, 'packages/cli/dist/src/main.js');
const showcaseRoot = join(repositoryRoot, 'examples/feature-showcase');
const nodeProject = join(showcaseRoot, 'node');
const browserProject = join(showcaseRoot, 'browser');
const cacheRoot = join(repositoryRoot, '.cache');
const phases = new Map([
	['node-static', verifyNodeStatic],
	['node-test-api', verifyNodeTestsAndApi],
	['node-execution', verifyNodeExecution],
	['binding', verifyBindingDrift],
	['adapter', verifyTypeScriptAdapter],
	['unsafe', verifyUnsafeFixture],
	['browser-build', verifyBrowserBuild],
]);

await mkdir(cacheRoot, { recursive: true });
const requestedPhase = parseRequestedPhase(process.argv.slice(2));
const selected = requestedPhase === undefined ? [...phases.entries()] : [[requestedPhase, phases.get(requestedPhase)]];
for (const [name, execute] of selected) {
	if (execute === undefined) throw new Error(`Unknown feature showcase phase: ${name}`);
	process.stdout.write(`\n[feature-showcase] phase ${name}\n`);
	await execute();
}
console.log(`Feature showcase ${requestedPhase ?? 'all phases'} verification completed successfully.`);

function parseRequestedPhase(args) {
	if (args.length === 0) return undefined;
	if (args.length !== 1 || !args[0].startsWith('--phase=')) throw new Error('Usage: node scripts/verify-feature-showcase.mjs [--phase=<name>]');
	const value = args[0].slice('--phase='.length);
	if (!phases.has(value)) throw new Error(`Unknown feature showcase phase: ${value}`);
	return value;
}

async function verifyNodeStatic() {
	await runCli('Node format', ['fmt', '--check', nodeProject]);
	await runCli('Node check', ['check', nodeProject]);
}

async function verifyNodeTestsAndApi() {
	await runCli('Node tests', ['test', nodeProject]);
	await runCli('Node API snapshot', ['api', nodeProject, '--out', join(nodeProject, 'virune.api.json'), '--check']);
}

async function verifyNodeExecution() {
	await runCli('Node build', ['build', nodeProject]);
	await runCli('Node run', ['run', nodeProject, '--', 'Alice', 'Bob']);
}

async function verifyBindingDrift() {
	const temporaryRoot = await mkdtemp(join(cacheRoot, 'feature-showcase-bind-'));
	try {
		const generated = join(temporaryRoot, 'node-os.virune');
		await runCli('Safe binding generation', ['bind', join(nodeProject, 'types/node-os-showcase.d.ts'), '--module', 'node:os', '--out', generated]);
		const expected = join(nodeProject, 'src/ffi/node-os.virune');
		const [generatedText, expectedText] = await Promise.all([readFile(generated, 'utf8'), readFile(expected, 'utf8')]);
		if (generatedText !== expectedText) throw new Error(`Safe binding drift detected: regenerate ${relativeDisplay(expected)} with the documented virune bind command.`);
	} finally {
		await rm(temporaryRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
	}
}

async function verifyTypeScriptAdapter() {
	await runCli('TypeScript adapter', ['interop', 'check', nodeProject]);
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

async function verifyBrowserBuild() {
	await runCli('Browser format', ['fmt', '--check', browserProject]);
	await runCli('Browser check', ['check', browserProject]);
	await runCli('Browser build', ['build', browserProject]);
}

async function runCli(label, args) {
	process.stdout.write(`[feature-showcase] ${label}\n`);
	await run(process.execPath, [cli, ...args]);
}

async function run(command, args) {
	await new Promise((resolveRun, rejectRun) => {
		const child = spawn(command, args, { cwd: repositoryRoot, stdio: 'inherit', env: process.env });
		child.once('error', rejectRun);
		child.once('exit', (code, signal) => {
			if (code === 0) resolveRun();
			else rejectRun(new Error(`${basename(command)} exited with ${code === null ? `signal ${signal ?? 'unknown'}` : `code ${code}`}`));
		});
	});
}

function relativeDisplay(path) {
	const value = relative(repositoryRoot, path);
	return value.length === 0 || value === '..' || value.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) ? path : value;
}
