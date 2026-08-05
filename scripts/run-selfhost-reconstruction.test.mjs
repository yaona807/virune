import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import {
	assertPaths,
	parseArguments,
	reconstruct,
	reconstructionCases,
	run,
	selectCase,
	validateCase,
} from './run-selfhost-reconstruction.mjs';

test('accepts one strict mode and rejects arbitrary input', () => {
	assert.deepEqual(parseArguments(['--case=postfix-try-propagation']), { caseId: 'postfix-try-propagation', list: false, help: false });
	assert.throws(() => parseArguments([]), /exactly one/);
	assert.throws(() => parseArguments(['--list', '--help']), /exactly one/);
	assert.throws(() => parseArguments(['--case=../value']), /lowercase letters/);
	assert.throws(() => parseArguments(['--command=rm']), /Unknown argument/);
});

test('pins PR 264 identity, changed paths, and validation', () => {
	const item = selectCase(reconstructionCases, 'postfix-try-propagation');
	assert.equal(item.pullRequest, 264);
	assert.equal(item.baseSha, '31915b119be388ed12966ebd6230dce46e6ed301');
	assert.equal(item.headSha, 'f505238e9cc8ecc24d8cb4b8ddbcaf2300d7417b');
	assert.deepEqual(item.changedPaths, [
		'packages/compiler/test/selfhost-try-propagation.test.ts',
		'selfhost/mvp/src/checker.virune',
		'selfhost/mvp/src/emitter.virune',
		'selfhost/mvp/src/parser.virune',
	]);
	assert.equal(item.validation.length, 3);
	assert.throws(() => selectCase(reconstructionCases, 'missing'), /Available cases/);
});

test('rejects invalid registry paths and diff paths', () => {
	const item = { id: 'fixture', baseSha: '1'.repeat(40), headSha: '2'.repeat(40), changedPaths: ['src/a.txt'], validation: [['node']] };
	assert.doesNotThrow(() => validateCase(item));
	assert.throws(() => validateCase({ ...item, changedPaths: ['../a.txt'] }), /Non-canonical/);
	assert.throws(() => validateCase({ ...item, changedPaths: ['src/a.txt', 'src/a.txt'] }), /unique/);
	assert.throws(() => validateCase({ ...item, changedPaths: ['src/z.txt', 'src/a.txt'] }), /sorted/);
	assert.throws(() => assertPaths(['src/b.txt'], ['src/a.txt'], 'fixture'), /changed-path mismatch/);
});

test('reconstructs in an isolated worktree and leaves no worktree behind', async () => {
	const repository = await mkdtemp(join(tmpdir(), 'virune-reconstruct-repo-'));
	const temporaryParent = await mkdtemp(join(tmpdir(), 'virune-reconstruct-temp-'));
	try {
		await git(repository, ['init']);
		await git(repository, ['config', 'user.name', 'Virune Test']);
		await git(repository, ['config', 'user.email', 'test@example.com']);
		await writeFile(join(repository, 'sample.txt'), 'before\n');
		await git(repository, ['add', 'sample.txt']);
		await git(repository, ['commit', '-m', 'base']);
		const baseSha = (await git(repository, ['rev-parse', 'HEAD'], true)).stdout.trim();
		await writeFile(join(repository, 'sample.txt'), 'after\n');
		await writeFile(join(repository, 'added.txt'), 'added\n');
		await git(repository, ['add', 'sample.txt', 'added.txt']);
		await git(repository, ['commit', '-m', 'head']);
		const headSha = (await git(repository, ['rev-parse', 'HEAD'], true)).stdout.trim();
		const result = await reconstruct({
			id: 'fixture', baseSha, headSha, changedPaths: ['added.txt', 'sample.txt'],
			validation: [[process.execPath, '-e', "const fs=require('node:fs');if(fs.readFileSync('sample.txt','utf8')!=='after\\n')process.exit(2)"]],
		}, { repositoryRoot: repository, temporaryParent });
		assert.equal(result.status, 'passed');
		assert.equal(await readFile(join(repository, 'sample.txt'), 'utf8'), 'after\n');
		assert.equal((await git(repository, ['worktree', 'list', '--porcelain'], true)).stdout.split('\n').filter(line => line.startsWith('worktree ')).length, 1);
	} finally {
		await rm(repository, { recursive: true, force: true });
		await rm(temporaryParent, { recursive: true, force: true });
	}
});

test('cleans the worktree after validation failure', async () => {
	const repository = await mkdtemp(join(tmpdir(), 'virune-reconstruct-fail-'));
	try {
		await git(repository, ['init']);
		await git(repository, ['config', 'user.name', 'Virune Test']);
		await git(repository, ['config', 'user.email', 'test@example.com']);
		await writeFile(join(repository, 'a.txt'), 'before\n');
		await git(repository, ['add', 'a.txt']);
		await git(repository, ['commit', '-m', 'base']);
		const baseSha = (await git(repository, ['rev-parse', 'HEAD'], true)).stdout.trim();
		await writeFile(join(repository, 'a.txt'), 'after\n');
		await git(repository, ['add', 'a.txt']);
		await git(repository, ['commit', '-m', 'head']);
		const headSha = (await git(repository, ['rev-parse', 'HEAD'], true)).stdout.trim();
		await assert.rejects(reconstruct({ id: 'fixture-fail', baseSha, headSha, changedPaths: ['a.txt'], validation: [[process.execPath, '-e', 'process.exit(7)']] }, { repositoryRoot: repository }), /exit code 7/);
		assert.equal((await git(repository, ['worktree', 'list', '--porcelain'], true)).stdout.split('\n').filter(line => line.startsWith('worktree ')).length, 1);
	} finally {
		await rm(repository, { recursive: true, force: true });
	}
});

async function git(repository, args, capture = false) {
	return run('git', args, { cwd: repository, capture });
}
