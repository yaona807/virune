import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	PROMOTION_SIGNALS,
	evaluateSelfhostPromotion,
	parseSelfhostPromotionPolicy,
	type PromotionSignal,
} from '../src/selfhost/promotion-policy.js';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const policyPath = join(repositoryRoot, 'selfhost', 'promotion-policy.v1.json');

async function loadPolicy() {
	return parseSelfhostPromotionPolicy(JSON.parse(await readFile(policyPath, 'utf8')) as unknown);
}

function passingSignals(): Readonly<Record<PromotionSignal, boolean>> {
	return Object.fromEntries(PROMOTION_SIGNALS.map(signal => [signal, true])) as Record<PromotionSignal, boolean>;
}

test('promotion policy is versioned, ordered, and fail-closed', async () => {
	const policy = await loadPolicy();
	assert.equal(policy.version, 1);
	assert.equal(policy.productionCompilerDefault, 'legacy');
	assert.equal(policy.automaticProductionSwitch, false);
	assert.equal(policy.seedAutoUpdate, false);
	assert.equal(policy.legacyRetentionReleaseCycles, 1);
	assert.deepEqual(policy.stages.map(stage => stage.target), [
		'non_blocking_pr',
		'nightly_shadow',
		'required_selfhost',
		'required_compiler',
		'internal_opt_in',
		'production_default',
	]);
});

test('required self-host gate needs parity signals and sufficient nightly history', async () => {
	const policy = await loadPolicy();
	const blocked = evaluateSelfhostPromotion(policy, {
		target: 'required_selfhost',
		completedTargets: ['non_blocking_pr', 'nightly_shadow'],
		signals: passingSignals(),
		consecutiveNightlySuccesses: 13,
		observationDays: 6,
		manualApproval: false,
	});
	assert.equal(blocked.eligible, false);
	assert.deepEqual(blocked.blockers, ['history:days:6/7', 'history:nightly:13/14']);

	const eligible = evaluateSelfhostPromotion(policy, {
		target: 'required_selfhost',
		completedTargets: ['non_blocking_pr', 'nightly_shadow'],
		signals: passingSignals(),
		consecutiveNightlySuccesses: 14,
		observationDays: 7,
		manualApproval: false,
	});
	assert.deepEqual(eligible, {
		target: 'required_selfhost',
		eligible: true,
		automatic: false,
		blockers: [],
	});
});

test('production default can only become manually eligible after every gate', async () => {
	const policy = await loadPolicy();
	const withoutApproval = evaluateSelfhostPromotion(policy, {
		target: 'production_default',
		completedTargets: [
			'non_blocking_pr',
			'nightly_shadow',
			'required_selfhost',
			'required_compiler',
			'internal_opt_in',
		],
		signals: passingSignals(),
		consecutiveNightlySuccesses: 60,
		observationDays: 30,
		manualApproval: false,
	});
	assert.deepEqual(withoutApproval.blockers, ['approval:manual']);

	const signals = { ...passingSignals(), rollbackSmoke: false };
	const failedRollback = evaluateSelfhostPromotion(policy, {
		target: 'production_default',
		completedTargets: ['internal_opt_in'],
		signals,
		consecutiveNightlySuccesses: 60,
		observationDays: 30,
		manualApproval: true,
	});
	assert.deepEqual(failedRollback.blockers, ['signal:rollbackSmoke']);

	const eligible = evaluateSelfhostPromotion(policy, {
		target: 'production_default',
		completedTargets: ['internal_opt_in'],
		signals: passingSignals(),
		consecutiveNightlySuccesses: 60,
		observationDays: 30,
		manualApproval: true,
	});
	assert.equal(eligible.eligible, true);
	assert.equal(eligible.automatic, false);
});

test('unsafe policy changes are rejected', async () => {
	const raw = JSON.parse(await readFile(policyPath, 'utf8')) as Record<string, unknown>;
	assert.throws(
		() => parseSelfhostPromotionPolicy({ ...raw, automaticProductionSwitch: true }),
		/automaticProductionSwitch must be false/u,
	);
	assert.throws(
		() => parseSelfhostPromotionPolicy({ ...raw, productionCompilerDefault: 'selfhost' }),
		/productionCompilerDefault must remain legacy/u,
	);
});
