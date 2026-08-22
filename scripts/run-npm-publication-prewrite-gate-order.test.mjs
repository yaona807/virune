import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

test('npm pre-write gate rechecks exact source after persisted evidence and immediately before mutation', () => {
	const source = readFileSync(resolve('scripts/run-npm-publication-prewrite-gate.mjs'), 'utf8');
	const readback = "assert(isDeepStrictEqual(persistedReport, report), '$.prewriteGateOutput', 'persisted pre-write gate evidence differs from the validated report');";
	const mutationBlock = 'if (mutation !== undefined) {';
	const cleanCheck = 'verifyExactCleanCheckout(commit);';
	const mutationCall = 'await mutation({';

	const readbackIndex = source.indexOf(readback);
	const mutationBlockIndex = source.indexOf(mutationBlock, readbackIndex + readback.length);
	const cleanCheckIndex = source.indexOf(cleanCheck, mutationBlockIndex + mutationBlock.length);
	const mutationCallIndex = source.indexOf(mutationCall, cleanCheckIndex + cleanCheck.length);

	assert.notEqual(readbackIndex, -1, 'expected persisted pre-write report read-back validation');
	assert.notEqual(mutationBlockIndex, -1, 'expected guarded mutation boundary');
	assert.notEqual(cleanCheckIndex, -1, 'expected exact clean checkout recheck inside mutation boundary');
	assert.notEqual(mutationCallIndex, -1, 'expected mutation invocation after exact clean checkout recheck');
	assert(readbackIndex < mutationBlockIndex);
	assert(mutationBlockIndex < cleanCheckIndex);
	assert(cleanCheckIndex < mutationCallIndex);
});
