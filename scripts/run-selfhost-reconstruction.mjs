import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const idPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const shaPattern = /^[0-9a-f]{40}$/;

export const reconstructionCases = Object.freeze([Object.freeze({
	id: 'postfix-try-propagation',
	pullRequest: 264,
	baseSha: '31915b119be388ed12966ebd6230dce46e6ed301',
	headSha: 'f505238e9cc8ecc24d8cb4b8ddbcaf2300d7417b',
	fetchRef: 'refs/pull/264/head',
	changedPaths: Object.freeze([
		'packages/compiler/test/selfhost-try-propagation.test.ts',
		'selfhost/mvp/src/checker.virune',
		'selfhost/mvp/src/emitter.virune',
		'selfhost/mvp/src/parser.virune',
	]),
	validation: Object.freeze([
		Object.freeze([npm, 'ci']),
		Object.freeze([npm, 'run', 'build']),
		Object.freeze([process.execPath, '--test', '--test-timeout=120000', 'packages/compiler/dist/test/selfhost-try-propagation.test.js']),
	]),
})]);

export function parseArguments(args) {
	let caseId = null;
	let list = false;
	let help = false;
	for (const arg of args) {
		if (arg.startsWith('--case=')) {
			if (caseId !== null) throw new Error('Duplicate --case option');
			caseId = arg.slice(7);
			if (!idPattern.test(caseId)) throw new Error('--case must use lowercase letters, digits, and single hyphens');
		} else if (arg === '--list') {
			if (list) throw new Error('Duplicate --list option');
			list = true;
		} else if (arg === '--help') {
			if (help) throw new Error('Duplicate --help option');
			help = true;
		} else {
			throw new Error(`Unknown argument: ${arg}`);
		}
	}
	if (Number(caseId !== null) + Number(list) + Number(help) !== 1) {
		throw new Error('Specify exactly one of --case=<id>, --list, or --help');
	}
	return { caseId, list, help };
}

export function selectCase(cases, caseId) {
	const matches = cases.filter(item => item.id === caseId);
	if (matches.length === 0) throw new Error(`Unknown reconstruction case: ${caseId}\nAvailable cases: ${cases.map(item => item.id).join(', ') || '(none)'}`);
	if (matches.length > 1) throw new Error(`Ambiguous reconstruction case: ${caseId}`);
	return validateCase(matches[0]);
}

export function validateCase(item) {
	if (!idPattern.test(item.id) || !shaPattern.test(item.baseSha) || !shaPattern.test(item.headSha)) {
		throw new Error(`Invalid reconstruction identity: ${item.id}`);
	}
	const paths = [...item.changedPaths];
	if (paths.length === 0 || new Set(paths).size !== paths.length || JSON.stringify(paths) !== JSON.stringify([...paths].sort())) {
		throw new Error(`Reconstruction paths must be non-empty, unique, and sorted: ${item.id}`);
	}
	for (const path of paths) {
		const segments = path.split('/');
		if (path.startsWith('/') || path.includes('\\') || segments.some(segment => segment === '' || segment === '.' || segment === '..')) {
			throw new Error(`Non-canonical reconstruction path: ${path}`);
		}
	}
	if (!Array.isArray(item.validation) || item.validation.length === 0 || item.validation.some(command => !Array.isArray(command) || command.length === 0 || command.some(part => typeof part !== 'string'))) {
		throw new Error(`Invalid reconstruction validation: ${item.id}`);
	}
	return item;
}

export function assertPaths(actual, expected, caseId) {
	const left = [...actual].filter(Boolean).sort();
	const right = [...expected].sort();
	if (JSON.stringify(left) !== JSON.stringify(right)) {
		throw new Error(`Reconstruction case ${caseId} changed-path mismatch.\nExpected: ${right.join(', ') || '(none)'}\nActual: ${left.join(', ') || '(none)'}`);
	}
	return left;
}

export async function reconstruct(item, options = {}) {
	validateCase(item);
	const repository = resolve(options.repositoryRoot ?? root);
	const execute = options.execute ?? run;
	const temporary = await mkdtemp(join(options.temporaryParent ?? tmpdir(), 'virune-reconstruct-'));
	const worktree = join(temporary, 'worktree');
	let registered = false;
	try {
		const top = (await execute('git', ['rev-parse', '--show-toplevel'], { cwd: repository, capture: true })).stdout.trim();
		if (!samePath(resolve(top), repository)) throw new Error(`Repository root mismatch: ${top}`);
		await requireCommit(repository, item.baseSha, item, execute);
		await requireCommit(repository, item.headSha, item, execute);
		const names = await execute('git', ['diff', '--name-only', '--no-renames', item.baseSha, item.headSha], { cwd: repository, capture: true });
		const paths = assertPaths(lines(names.stdout), item.changedPaths, item.id);
		const patch = await execute('git', ['diff', '--binary', '--full-index', '--no-renames', item.baseSha, item.headSha, '--', ...paths], { cwd: repository, capture: true });
		if (patch.stdout === '') throw new Error(`Reconstruction case ${item.id} produced an empty patch`);
		await execute('git', ['worktree', 'add', '--detach', worktree, item.baseSha], { cwd: repository });
		registered = true;
		await execute('git', ['apply', '--check', '--whitespace=error-all', '-'], { cwd: worktree, input: patch.stdout });
		await execute('git', ['apply', '--whitespace=error-all', '-'], { cwd: worktree, input: patch.stdout });
		const status = await execute('git', ['status', '--porcelain=v1', '-z'], { cwd: worktree, capture: true });
		assertPaths(porcelainPaths(status.stdout), item.changedPaths, item.id);
		for (const [command, ...args] of item.validation) await execute(command, args, { cwd: worktree, stdio: 'inherit' });
		return {
			schemaVersion: 1,
			caseId: item.id,
			pullRequest: item.pullRequest ?? null,
			baseSha: item.baseSha,
			headSha: item.headSha,
			changedPaths: paths,
			validation: item.validation.map(([command, ...args]) => ({ command: commandName(command), argumentsList: args })),
			status: 'passed',
		};
	} finally {
		if (registered) {
			try { await execute('git', ['worktree', 'remove', '--force', worktree], { cwd: repository }); }
			catch {
				await rm(worktree, { recursive: true, force: true });
				try { await execute('git', ['worktree', 'prune'], { cwd: repository }); } catch { /* best effort */ }
			}
		}
		await rm(temporary, { recursive: true, force: true });
	}
}

async function requireCommit(repository, sha, item, execute) {
	try { await execute('git', ['cat-file', '-e', `${sha}^{commit}`], { cwd: repository, capture: true }); }
	catch { throw new Error(`Missing reconstruction commit ${sha}. Fetch repository history and ${item.fetchRef ?? 'the registered head'} before retrying.`); }
}

function lines(value) { return value.split(/\r?\n/u).filter(Boolean); }
function samePath(left, right) { return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right; }
function commandName(command) {
	if (command === process.execPath) return 'node';
	const name = basename(command).toLowerCase();
	return name === 'npm.cmd' ? 'npm' : basename(command);
}
function porcelainPaths(value) {
	const records = value.split('\0').filter(Boolean);
	const paths = [];
	for (let index = 0; index < records.length; index++) {
		const code = records[index].slice(0, 2);
		paths.push(records[index].slice(3));
		if (code.includes('R') || code.includes('C')) paths.push(records[++index]);
	}
	return paths;
}

export function run(command, args, options = {}) {
	return new Promise((resolvePromise, rejectPromise) => {
		const capture = options.capture === true;
		const stdio = capture
			? ['pipe', 'pipe', 'pipe']
			: options.input !== undefined ? ['pipe', 'inherit', 'inherit'] : (options.stdio ?? 'inherit');
		const child = spawn(command, args, { cwd: options.cwd, shell: false, stdio });
		let stdout = '';
		let stderr = '';
		if (capture) {
			child.stdout.setEncoding('utf8');
			child.stderr.setEncoding('utf8');
			child.stdout.on('data', chunk => { stdout += chunk; });
			child.stderr.on('data', chunk => { stderr += chunk; });
		}
		child.once('error', rejectPromise);
		child.once('exit', code => code === 0
			? resolvePromise({ stdout, stderr })
			: rejectPromise(new Error(`${[command, ...args].join(' ')} failed with exit code ${code ?? 1}${stderr === '' ? '' : `\n${stderr.trim()}`}`)));
		if (options.input !== undefined) child.stdin.end(options.input);
	});
}

export function help() {
	return [
		'Usage:',
		'  npm run selfhost:reconstruct -- --case=<id>',
		'  npm run selfhost:reconstruct -- --list',
		'',
		'Cases fix the base/head commits, changed paths, and validation commands.',
		'Execution uses an isolated temporary Git worktree and never accepts paths or shell commands.',
	].join('\n');
}

export async function main(args = process.argv.slice(2)) {
	const options = parseArguments(args);
	if (options.help) { console.log(help()); return 0; }
	if (options.list) { for (const item of reconstructionCases) console.log(item.id); return 0; }
	const item = selectCase(reconstructionCases, options.caseId);
	console.log(`Self-host reconstruction case: ${item.id}`);
	const result = await reconstruct(item);
	console.log('SELFHOST_RECONSTRUCTION_JSON');
	console.log(JSON.stringify(result));
	return 0;
}

const invoked = process.argv[1] === undefined ? null : pathToFileURL(resolve(process.argv[1])).href;
if (invoked === import.meta.url) {
	try { process.exitCode = await main(); }
	catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
}
