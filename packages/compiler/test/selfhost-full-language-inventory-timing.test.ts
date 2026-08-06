import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
	formatFullLanguageInventoryProgress,
	runFullLanguageInventory,
	serializeFullLanguageInventoryTimingEvidence,
	type FullLanguageInventoryTimingEvidence,
} from '../src/selfhost/full-language-inventory-runner.js';

test('progress formatting is stable and machine-readable', () => {
	assert.equal(
		formatFullLanguageInventoryProgress({
			schemaVersion: 1,
			kind: 'heartbeat',
			phase: 'compile-project-first',
			elapsedMs: 61_000,
			phaseElapsedMs: 60_000,
			message: null,
		}),
		'SELFHOST_INVENTORY_PROGRESS heartbeat phase=compile-project-first elapsedMs=61000 phaseElapsedMs=60000',
	);
});

test('failure evidence preserves the default two-run contract after cleanup', async () => {
	const repositoryRoot = await mkdtemp(join(tmpdir(), 'virune-inventory-timing-'));
	const captured: { value: FullLanguageInventoryTimingEvidence | null } = { value: null };
	try {
		await assert.rejects(
			runFullLanguageInventory({
				repositoryRoot,
				heartbeatIntervalMs: 0,
				onTimingEvidence: value => {
					captured.value = value;
				},
			}),
		);
		const evidence = requireEvidence(captured.value);
		assert.equal(evidence.schemaVersion, 1);
		assert.equal(evidence.claim, 'selfhost-full-language-inventory-timing');
		assert.equal(evidence.status, 'failure');
		assert.equal(evidence.compileRuns, 2);
		assert.equal(evidence.failure?.phase, 'build-project');
		assert.ok(evidence.phases.some(phase => phase.name === 'prepare' && phase.status === 'success'));
		assert.ok(evidence.phases.some(phase => phase.name === 'build-project' && phase.status === 'failure'));
		assert.ok(evidence.phases.some(phase => phase.name === 'cleanup' && phase.status === 'success'));
		assert.equal(
			serializeFullLanguageInventoryTimingEvidence(evidence),
			`${JSON.stringify(evidence)}\n`,
		);
	} finally {
		await rm(repositoryRoot, { recursive: true, force: true });
	}
});

test('single-run diagnostics use the same engine and omit the second compile phase', async () => {
	const repositoryRoot = await mkdtemp(join(tmpdir(), 'virune-inventory-single-run-'));
	const captured: { value: FullLanguageInventoryTimingEvidence | null } = { value: null };
	try {
		await assert.rejects(
			runFullLanguageInventory({
				repositoryRoot,
				compileRuns: 1,
				heartbeatIntervalMs: 0,
				onTimingEvidence: value => {
					captured.value = value;
				},
			}),
		);
		const evidence = requireEvidence(captured.value);
		assert.equal(evidence.compileRuns, 1);
		assert.equal(evidence.failure?.phase, 'build-project');
		assert.equal(evidence.phases.some(phase => phase.name === 'compile-project-second'), false);
	} finally {
		await rm(repositoryRoot, { recursive: true, force: true });
	}
});

test('invalid compile run counts fail closed before repository work begins', async () => {
	await assert.rejects(
		runFullLanguageInventory({
			repositoryRoot: '.',
			compileRuns: 3 as 1,
		}),
		/compileRuns must be 1 or 2/u,
	);
});

function requireEvidence(
	value: FullLanguageInventoryTimingEvidence | null,
): FullLanguageInventoryTimingEvidence {
	if (value === null) throw new Error('Expected full-language inventory timing evidence');
	return value;
}
