import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
	formatFullLanguageInventoryProgress,
	resolveFullLanguageInventoryCompileRuns,
	resolveFullLanguageInventoryCompileRunsForEvent,
	runFullLanguageInventory,
	serializeFullLanguageInventoryTimingEvidence,
	type FullLanguageInventoryTimingEvidence,
} from '../src/selfhost/full-language-inventory-runner.js';

test('compile-run selection is fail-closed and defaults to deterministic mode', () => {
	assert.equal(resolveFullLanguageInventoryCompileRuns(undefined), 2);
	assert.equal(resolveFullLanguageInventoryCompileRuns(1), 1);
	assert.equal(resolveFullLanguageInventoryCompileRuns('1'), 1);
	assert.equal(resolveFullLanguageInventoryCompileRuns(2), 2);
	assert.equal(resolveFullLanguageInventoryCompileRuns('2'), 2);
	assert.throws(() => resolveFullLanguageInventoryCompileRuns(0), /exactly 1 or 2/);
	assert.throws(() => resolveFullLanguageInventoryCompileRuns('3'), /exactly 1 or 2/);
});

test('CI event selection uses one run only for pull requests', () => {
	assert.equal(resolveFullLanguageInventoryCompileRunsForEvent('pull_request', undefined), 1);
	assert.equal(resolveFullLanguageInventoryCompileRunsForEvent('push', undefined), 2);
	assert.equal(resolveFullLanguageInventoryCompileRunsForEvent('schedule', undefined), 2);
	assert.equal(resolveFullLanguageInventoryCompileRunsForEvent('workflow_dispatch', undefined), 2);
	assert.equal(resolveFullLanguageInventoryCompileRunsForEvent(undefined, undefined), 2);
	assert.equal(resolveFullLanguageInventoryCompileRunsForEvent('pull_request', '2'), 2);
	assert.equal(resolveFullLanguageInventoryCompileRunsForEvent('push', '1'), 1);
	assert.throws(
		() => resolveFullLanguageInventoryCompileRunsForEvent('pull_request', '3'),
		/exactly 1 or 2/,
	);
});

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

test('failure evidence records one-run PR mode after cleanup', async () => {
	const evidence = await captureFailureEvidence(1);
	assert.equal(evidence.schemaVersion, 1);
	assert.equal(evidence.claim, 'selfhost-full-language-inventory-timing');
	assert.equal(evidence.status, 'failure');
	assert.equal(evidence.compileRuns, 1);
	assert.equal(evidence.determinismChecked, false);
	assert.equal(evidence.failure?.phase, 'build-project');
	assert.ok(evidence.phases.some(phase => phase.name === 'prepare' && phase.status === 'success'));
	assert.ok(evidence.phases.some(phase => phase.name === 'build-project' && phase.status === 'failure'));
	assert.ok(evidence.phases.some(phase => phase.name === 'cleanup' && phase.status === 'success'));
	assert.equal(serializeFullLanguageInventoryTimingEvidence(evidence), `${JSON.stringify(evidence)}\n`);
});

test('failure evidence preserves two-run deterministic default', async () => {
	const evidence = await captureFailureEvidence(undefined);
	assert.equal(evidence.compileRuns, 2);
	assert.equal(evidence.determinismChecked, true);
});

async function captureFailureEvidence(
	compileRuns: 1 | 2 | undefined,
): Promise<FullLanguageInventoryTimingEvidence> {
	const repositoryRoot = await mkdtemp(join(tmpdir(), 'virune-inventory-timing-'));
	const captured: { value: FullLanguageInventoryTimingEvidence | null } = { value: null };
	try {
		const options = {
			repositoryRoot,
			heartbeatIntervalMs: 0,
			onTimingEvidence: (value: FullLanguageInventoryTimingEvidence) => {
				captured.value = value;
			},
		};
		await assert.rejects(
			runFullLanguageInventory(compileRuns === undefined
				? options
				: { ...options, compileRuns }),
		);
		return requireEvidence(captured.value);
	} finally {
		await rm(repositoryRoot, { recursive: true, force: true });
	}
}

function requireEvidence(
	value: FullLanguageInventoryTimingEvidence | null,
): FullLanguageInventoryTimingEvidence {
	if (value === null) throw new Error('Expected full-language inventory timing evidence');
	return value;
}
