import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import {
	discoverFocusedCases,
	focusedChildArguments,
	parseFocusedArguments,
	resolveFocusedCase,
	runFocusedCase,
} from './run-selfhost-focused.mjs';

test('parses one strict selection mode and rejects unsafe input', () => {
	assert.deepEqual(parseFocusedArguments(['--case=expected-list-literals']), {
		requestedCase: 'expected-list-literals',
		list: false,
		help: false,
	});
	assert.throws(() => parseFocusedArguments([]), /exactly one/);
	assert.throws(() => parseFocusedArguments(['--list', '--case=value']), /exactly one/);
	assert.throws(() => parseFocusedArguments(['--case=../value']), /lowercase letters/);
	assert.throws(() => parseFocusedArguments(['--case=value*']), /lowercase letters/);
	assert.throws(() => parseFocusedArguments(['--case=value', '--case=other']), /Duplicate/);
	assert.throws(() => parseFocusedArguments(['--test-name-pattern=value']), /Unknown argument/);
});

test('discovers deterministic selectable cases and excludes the inventory', async () => {
	const root = await mkdtemp(join(tmpdir(), 'virune-focused-'));
	try {
		await mkdir(root, { recursive: true });
		await Promise.all([
			writeFile(join(root, 'selfhost-zeta.test.js'), ''),
			writeFile(join(root, 'selfhost-alpha.test.js'), ''),
			writeFile(join(root, 'selfhost-full-language-inventory.test.js'), ''),
			writeFile(join(root, 'compiler.test.js'), ''),
		]);
		assert.deepEqual((await discoverFocusedCases(root)).map(item => item.id), ['alpha', 'zeta']);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test('resolves exactly one case and reports useful failures', () => {
	const cases = [
		{ id: 'alpha', fileName: 'selfhost-alpha.test.js', path: '/tmp/selfhost-alpha.test.js' },
		{ id: 'beta', fileName: 'selfhost-beta.test.js', path: '/tmp/selfhost-beta.test.js' },
	];
	assert.equal(resolveFocusedCase(cases, 'beta').fileName, 'selfhost-beta.test.js');
	assert.throws(() => resolveFocusedCase(cases, 'missing'), /Available cases: alpha, beta/);
	assert.throws(() => resolveFocusedCase([...cases, cases[0]], 'alpha'), /Ambiguous/);
	assert.throws(() => resolveFocusedCase(cases, 'full-language-inventory'), /selfhost:inventory/);
});

test('delegates to the existing unit-test runner without a shell and propagates exit status', async () => {
	const selectedCase = { id: 'alpha', fileName: 'selfhost-alpha.test.js', path: '/tmp/selfhost-alpha.test.js' };
	const child = focusedChildArguments(selectedCase, '/repo');
	assert.equal(child.command, process.execPath);
	assert.deepEqual(child.argumentsList, [
		'scripts/run-unit-tests.mjs',
		`--filter=${join('packages', 'compiler', 'dist', 'test', 'selfhost-alpha.test.js')}`,
	]);
	assert.deepEqual(child.options, { cwd: '/repo', stdio: 'inherit', shell: false });

	let received;
	const code = await runFocusedCase(selectedCase, {
		repositoryRoot: '/repo',
		spawnProcess(command, argumentsList, options) {
			received = { command, argumentsList, options };
			const processHandle = new EventEmitter();
			queueMicrotask(() => processHandle.emit('exit', 7));
			return processHandle;
		},
	});
	assert.equal(code, 7);
	assert.deepEqual(received, child);
});

test('build wrappers forward CLI arguments to their built commands', async () => {
	const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
	const manifest = JSON.parse(await readFile(join(repositoryRoot, 'package.json'), 'utf8'));
	assert.equal(
		manifest.scripts['selfhost:inventory'],
		'npm run build && npm run selfhost:inventory:built --',
	);
	assert.equal(
		manifest.scripts['selfhost:focused'],
		'npm run build && npm run selfhost:focused:built --',
	);
});
