import { spawn } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const compiledTestDirectory = join(repositoryRoot, 'packages', 'compiler', 'dist', 'test');
const casePattern = /^selfhost-([a-z0-9]+(?:-[a-z0-9]+)*)\.test\.js$/;
const reservedCases = new Map([
	['full-language-inventory', 'Use `npm run selfhost:inventory` for the canonical full-language inventory.'],
]);

export function parseFocusedArguments(argumentsList) {
	let requestedCase = null;
	let list = false;
	let help = false;
	for (const argument of argumentsList) {
		if (argument.startsWith('--case=')) {
			if (requestedCase !== null) throw new Error('Duplicate --case option');
			requestedCase = argument.slice('--case='.length);
			if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(requestedCase)) {
				throw new Error('--case must use lowercase letters, digits, and single hyphens');
			}
			continue;
		}
		if (argument === '--list') {
			if (list) throw new Error('Duplicate --list option');
			list = true;
			continue;
		}
		if (argument === '--help') {
			if (help) throw new Error('Duplicate --help option');
			help = true;
			continue;
		}
		throw new Error(`Unknown argument: ${argument}`);
	}
	const selectedModes = Number(requestedCase !== null) + Number(list) + Number(help);
	if (selectedModes !== 1) {
		throw new Error('Specify exactly one of --case=<id>, --list, or --help');
	}
	return { requestedCase, list, help };
}

export async function discoverFocusedCases(directory = compiledTestDirectory) {
	let entries;
	try {
		entries = await readdir(directory, { withFileTypes: true });
	} catch (error) {
		if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
			throw new Error('Compiled self-host tests were not found. Run `npm run build` first.');
		}
		throw error;
	}
	const cases = [];
	for (const entry of entries) {
		if (!entry.isFile()) continue;
		const matched = casePattern.exec(entry.name);
		if (matched === null) continue;
		const id = matched[1];
		if (reservedCases.has(id)) continue;
		cases.push({ id, fileName: entry.name, path: join(directory, entry.name) });
	}
	return cases.sort((left, right) => left.id.localeCompare(right.id));
}

export function resolveFocusedCase(cases, requestedCase) {
	const reservedMessage = reservedCases.get(requestedCase);
	if (reservedMessage !== undefined) throw new Error(reservedMessage);
	const matched = cases.filter(item => item.id === requestedCase);
	if (matched.length === 0) {
		const available = cases.length === 0 ? '(none)' : cases.map(item => item.id).join(', ');
		throw new Error(`Unknown self-host focused case: ${requestedCase}\nAvailable cases: ${available}`);
	}
	if (matched.length !== 1) throw new Error(`Ambiguous self-host focused case: ${requestedCase}`);
	return matched[0];
}

export function focusedChildArguments(selectedCase, root = repositoryRoot) {
	const relativeTestPath = join('packages', 'compiler', 'dist', 'test', selectedCase.fileName);
	return {
		command: process.execPath,
		argumentsList: ['scripts/run-unit-tests.mjs', `--filter=${relativeTestPath}`],
		options: { cwd: root, stdio: 'inherit', shell: false },
	};
}

export function runFocusedCase(selectedCase, options = {}) {
	const root = options.repositoryRoot ?? repositoryRoot;
	const spawnProcess = options.spawnProcess ?? spawn;
	const child = focusedChildArguments(selectedCase, root);
	return new Promise((resolvePromise, reject) => {
		const processHandle = spawnProcess(child.command, child.argumentsList, child.options);
		processHandle.once('error', reject);
		processHandle.once('exit', code => resolvePromise(code ?? 1));
	});
}

export function focusedHelp() {
	return [
		'Usage:',
		'  npm run selfhost:focused -- --case=<id>',
		'  npm run selfhost:focused:built -- --case=<id>',
		'  npm run selfhost:focused:built -- --list',
		'',
		'Only compiled packages/compiler selfhost-<id>.test.js files are selectable.',
	].join('\n');
}

export async function main(argumentsList = process.argv.slice(2)) {
	const options = parseFocusedArguments(argumentsList);
	if (options.help) {
		console.log(focusedHelp());
		return 0;
	}
	const cases = await discoverFocusedCases();
	if (options.list) {
		for (const item of cases) console.log(item.id);
		return 0;
	}
	const selectedCase = resolveFocusedCase(cases, options.requestedCase);
	console.log(`Self-host focused case: ${selectedCase.id}`);
	return runFocusedCase(selectedCase);
}

const invokedUrl = process.argv[1] === undefined ? null : pathToFileURL(resolve(process.argv[1])).href;
if (invokedUrl === import.meta.url) {
	try {
		process.exitCode = await main();
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	}
}
