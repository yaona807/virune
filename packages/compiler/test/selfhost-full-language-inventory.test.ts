import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	resolveFullLanguageInventoryCompileRunsForEvent,
	runFullLanguageInventory,
} from '../src/selfhost/full-language-inventory-runner.js';
import { serializeFullLanguageInventory } from '../src/selfhost/full-language-inventory.js';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const inventoryEvidencePath = join(
	repositoryRoot,
	'.cache',
	'ci-timings',
	'selfhost-full-language-inventory.json',
);
const compileRuns = resolveFullLanguageInventoryCompileRunsForEvent(
	process.env.GITHUB_EVENT_NAME,
	process.env.VIRUNE_SELFHOST_INVENTORY_COMPILE_RUNS,
);

test('full-language inventory is ready for the canonical self-host source set', { timeout: 7_200_000 }, async () => {
	const inventory = await runFullLanguageInventory({ repositoryRoot, compileRuns });
	assert.equal(inventory.sourceCount, inventory.parsedModules);
	assert.equal(inventory.sourceCount, inventory.checkedModules);
	assert.equal(
		inventory.sourcesWithDiagnostics.length + inventory.sourcesWithoutDiagnostics.length,
		inventory.sourceCount,
	);
	assert.equal(
		inventory.codeCounts.reduce((total, entry) => total + entry.count, 0),
		inventory.diagnosticCount,
	);
	assert.equal(inventory.firstDiagnostics.length, inventory.diagnosticSourceCount);
	assert.deepEqual(
		inventory.firstDiagnostics.map(item => item.sourcePath),
		inventory.sourcesWithDiagnostics,
	);
	assert.ok(inventory.firstDiagnostics.every(item => item.span.end.offset >= item.span.start.offset));
	assert.deepEqual(inventory.boundaryBlockers, []);
	const diagnosticCountFor = (code: string): number =>
		inventory.codeCounts.find(entry => entry.code === code)?.count ?? 0;
	assert.equal(inventory.status, 'ready');
	assert.equal(inventory.capability.ready, true);
	assert.deepEqual(inventory.capability.blockers, []);
	assert.equal(inventory.diagnosticCount, 0);
	assert.equal(inventory.diagnosticSourceCount, 0);
	assert.equal(inventory.emittedModules, inventory.sourceCount);
	assert.equal(diagnosticCountFor('L2014'), 0);
	assert.equal(diagnosticCountFor('L2020'), 0);
	assert.equal(diagnosticCountFor('L2021'), 0);
	await mkdir(dirname(inventoryEvidencePath), { recursive: true });
	await writeFile(inventoryEvidencePath, serializeFullLanguageInventory(inventory), 'utf8');
	console.log(`SELFHOST_FULL_LANGUAGE_INVENTORY compileRuns=${compileRuns} ${JSON.stringify(inventory)}`);
});
