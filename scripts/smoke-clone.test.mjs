import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
	createSourceCloneSmokeSteps,
	runSourceCloneSmoke,
} from './smoke-clone.mjs';

const silentStream = { write() {} };

function captureStream() {
	let value = '';
	return {
		stream: { write(chunk) { value += String(chunk); } },
		value: () => value,
	};
}

async function temporaryRoot() {
	return mkdtemp(join(tmpdir(), 'virune-smoke-clone-test-'));
}

test('defines stable source-clone smoke step identities', () => {
	const root = '/repo';
	const workspace = '/tmp/workspace';
	const steps = createSourceCloneSmokeSteps({
		root,
		cli: '/repo/packages/cli/dist/src/main.js',
		workspace,
	});
	assert.deepEqual(steps.map(step => step.id), [
		'cli-version',
		'repository-check',
		'repository-run',
		'project-init',
		'project-check',
		'project-run',
		'example-user-directory',
	]);
	assert.equal(steps.every(step => step.cwd === root), true);
});

test('writes success evidence and cleans the temporary workspace', async () => {
	const root = await temporaryRoot();
	const evidencePath = join(root, 'evidence.json');
	let removeCalls = 0;
	const output = captureStream();
	try {
		const evidence = await runSourceCloneSmoke({
			root,
			temporaryRoot: join(root, 'tmp'),
			evidencePath,
			execute: async () => ({ status: 0, signal: null, error: null, stdout: '', stderr: '' }),
			remove: async (path, options) => {
				removeCalls += 1;
				await rm(path, options);
			},
			now: increasingClock(),
			stdout: output.stream,
			stderr: silentStream,
		});
		assert.equal(evidence.status, 'success');
		assert.equal(evidence.completedSteps.length, 7);
		assert.equal(removeCalls, 1);
		assert.match(output.value(), /SOURCE_CLONE_SMOKE_EVIDENCE/);
		assert.deepEqual(JSON.parse(await readFile(evidencePath, 'utf8')), evidence);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test('records the failed step with bounded output and portable paths', async () => {
	const root = await temporaryRoot();
	const evidencePath = join(root, 'evidence.json');
	let call = 0;
	try {
		await assert.rejects(
			() => runSourceCloneSmoke({
				root,
				temporaryRoot: join(root, 'tmp'),
				evidencePath,
				execute: async () => {
					call += 1;
					if (call !== 5) return { status: 0, signal: null, error: null, stdout: '', stderr: '' };
					return {
						status: 2,
						signal: null,
						error: null,
						stdout: 'x'.repeat(9_000),
						stderr: 'project check failed',
					};
				},
				now: increasingClock(),
				stdout: silentStream,
				stderr: silentStream,
			}),
			/Source clone smoke failed at project-check/u,
		);
		const evidence = JSON.parse(await readFile(evidencePath, 'utf8'));
		assert.equal(evidence.status, 'failure');
		assert.equal(evidence.failedStep, 'project-check');
		assert.equal(evidence.completedSteps.length, 4);
		assert.equal(evidence.failure.exitCode, 2);
		assert.equal(evidence.failure.stdoutTail.length, 8 * 1024);
		assert.equal(evidence.failure.stderrTail, 'project check failed');
		assert.equal(JSON.stringify(evidence).includes(root), false);
		assert.equal(evidence.failure.command.arguments.some(value => value.includes('<workspace>/app')), true);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test('turns cleanup failure into machine-readable failure evidence', async () => {
	const root = await temporaryRoot();
	const evidencePath = join(root, 'evidence.json');
	try {
		await assert.rejects(
			() => runSourceCloneSmoke({
				root,
				temporaryRoot: join(root, 'tmp'),
				evidencePath,
				execute: async () => ({ status: 0, signal: null, error: null, stdout: '', stderr: '' }),
				remove: async () => {
					throw new Error('cleanup unavailable');
				},
				now: increasingClock(),
				stdout: silentStream,
				stderr: silentStream,
			}),
			/Source clone smoke failed at cleanup: cleanup unavailable/u,
		);
		const evidence = JSON.parse(await readFile(evidencePath, 'utf8'));
		assert.equal(evidence.failedStep, 'cleanup');
		assert.equal(evidence.failure.cleanupError, 'cleanup unavailable');
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

function increasingClock() {
	let value = Date.UTC(2026, 7, 6, 5, 0, 0);
	return () => {
		value += 10;
		return value;
	};
}
