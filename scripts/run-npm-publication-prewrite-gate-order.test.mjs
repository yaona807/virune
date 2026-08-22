import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

test('npm pre-write gate rechecks exact source inside cleanup scope immediately before mutation', () => {
	const source = readFileSync(resolve('scripts/run-npm-publication-prewrite-gate.mjs'), 'utf8');
	const readback = "assert(isDeepStrictEqual(persistedReport, report), '$.prewriteGateOutput', 'persisted pre-write gate evidence differs from the validated report');";
	const mutationBlock = 'if (mutation !== undefined) {';
	const tryBlock = 'try {';
	const cleanCheck = 'verifyExactCleanCheckout(commit);';
	const mutationCall = 'await mutation({';
	const catchBlock = '} catch (error) {';
	const cleanup = 'await rm(NPM_PUBLICATION_PREWRITE_OUTPUT, { force: true });';

	const readbackIndex = source.indexOf(readback);
	const mutationBlockIndex = source.indexOf(mutationBlock, readbackIndex + readback.length);
	const tryBlockIndex = source.indexOf(tryBlock, mutationBlockIndex + mutationBlock.length);
	const cleanCheckIndex = source.indexOf(cleanCheck, tryBlockIndex + tryBlock.length);
	const mutationCallIndex = source.indexOf(mutationCall, cleanCheckIndex + cleanCheck.length);
	const catchBlockIndex = source.indexOf(catchBlock, mutationCallIndex + mutationCall.length);
	const cleanupIndex = source.indexOf(cleanup, catchBlockIndex + catchBlock.length);

	assert.notEqual(readbackIndex, -1, 'expected persisted pre-write report read-back validation');
	assert.notEqual(mutationBlockIndex, -1, 'expected guarded mutation boundary');
	assert.notEqual(tryBlockIndex, -1, 'expected cleanup scope around final source check and mutation');
	assert.notEqual(cleanCheckIndex, -1, 'expected exact clean checkout recheck inside cleanup scope');
	assert.notEqual(mutationCallIndex, -1, 'expected mutation invocation after exact clean checkout recheck');
	assert.notEqual(catchBlockIndex, -1, 'expected failure cleanup catch path');
	assert.notEqual(cleanupIndex, -1, 'expected combined success evidence cleanup on boundary failure');
	assert(readbackIndex < mutationBlockIndex);
	assert(mutationBlockIndex < tryBlockIndex);
	assert(tryBlockIndex < cleanCheckIndex);
	assert(cleanCheckIndex < mutationCallIndex);
	assert(mutationCallIndex < catchBlockIndex);
	assert(catchBlockIndex < cleanupIndex);
});
