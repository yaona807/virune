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

test('failure evidence is emitted after cleanup without running the compiler twice', async () => {
	const repositoryRoot = await mkdtemp(join(tmpdir(), 'virune-inventory-timing-'));
	let evidence: FullLanguageInventoryTimingEvidence | null = null;
	try {
		await assert.rejects(
			runFullLanguageInventory({
				repositoryRoot,
				heartbeatIntervalMs: 0,
				onTimingEvidence: value => {
					evidence = value;
				},
			}),
		);
		assert.notEqual(evidence, null);
		assert.equal(evidence?.schemaVersion, 1);
		assert.equal(evidence?.claim, 'selfhost-full-language-inventory-timing');
		assert.equal(evidence?.status, 'failure');
		assert.equal(evidence?.failure?.phase, 'build-project');
		assert.ok(evidence?.phases.some(phase => phase.name === 'prepare' && phase.status === 'success'));
		assert.ok(evidence?.phases.some(phase => phase.name === 'build-project' && phase.status === 'failure'));
		assert.ok(evidence?.phases.some(phase => phase.name === 'cleanup' && phase.status === 'success'));
		assert.equal(
			serializeFullLanguageInventoryTimingEvidence(evidence as FullLanguageInventoryTimingEvidence),
			`${JSON.stringify(evidence)}\n`,
		);
	} finally {
		await rm(repositoryRoot, { recursive: true, force: true });
	}
});
