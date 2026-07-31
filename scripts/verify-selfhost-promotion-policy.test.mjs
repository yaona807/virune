import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { verifySelfhostPromotionPolicy } from './verify-selfhost-promotion-policy.mjs';

const repositoryRoot = new URL('..', import.meta.url);
const policyRelativePath = '.github/self-hosting/promotion-policy-v1.json';

async function fixture(mutate = policy => policy) {
	const root = await mkdtemp(join(tmpdir(), 'virune-selfhost-promotion-'));
	const source = JSON.parse(await readFile(new URL(policyRelativePath, repositoryRoot), 'utf8'));
	const policy = mutate(structuredClone(source));
	const target = join(root, policyRelativePath);
	await mkdir(join(root, '.github/self-hosting'), { recursive: true });
	await writeFile(target, `${JSON.stringify(policy, null, '\t')}\n`);
	return root;
}

test('accepts the repository self-host promotion policy', async () => {
	await assert.doesNotReject(verifySelfhostPromotionPolicy());
});

test('rejects automatic promotion', async t => {
	const root = await fixture(policy => ({ ...policy, automaticPromotionAllowed: true }));
	t.after(() => rm(root, { recursive: true, force: true }));
	await assert.rejects(verifySelfhostPromotionPolicy(root), /automaticPromotionAllowed must be false/u);
});

test('rejects stage reordering', async t => {
	const root = await fixture(policy => {
		[policy.stages[1], policy.stages[2]] = [policy.stages[2], policy.stages[1]];
		return policy;
	});
	t.after(() => rm(root, { recursive: true, force: true }));
	await assert.rejects(verifySelfhostPromotionPolicy(root), /stages\[1\]\.id must be nightly-shadow/u);
});

test('rejects unexplained differentials', async t => {
	const root = await fixture(policy => {
		policy.stages[2].promotionRequirements.maximumUnexplainedDifferentials = 1;
		return policy;
	});
	t.after(() => rm(root, { recursive: true, force: true }));
	await assert.rejects(verifySelfhostPromotionPolicy(root), /maximumUnexplainedDifferentials must be 0/u);
});

test('rejects evidence removed by a later stage', async t => {
	const root = await fixture(policy => {
		policy.stages[3].requiredEvidence = policy.stages[3].requiredEvidence
			.filter(item => item !== 'stage1-stage2');
		return policy;
	});
	t.after(() => rm(root, { recursive: true, force: true }));
	await assert.rejects(verifySelfhostPromotionPolicy(root), /requiredEvidence removed stage1-stage2/u);
});

test('rejects a production switch without rollback evidence', async t => {
	const root = await fixture(policy => {
		const production = policy.stages.at(-1);
		production.promotionRequirements.rollbackEvidenceRequired = false;
		production.requiredEvidence = production.requiredEvidence.filter(item => item !== 'rollback-smoke');
		return policy;
	});
	t.after(() => rm(root, { recursive: true, force: true }));
	await assert.rejects(verifySelfhostPromotionPolicy(root), /rollbackEvidenceRequired must be true/u);
});

test('rejects reduced observation thresholds', async t => {
	const root = await fixture(policy => {
		policy.stages[3].promotionRequirements.minimumObservationDays = 7;
		return policy;
	});
	t.after(() => rm(root, { recursive: true, force: true }));
	await assert.rejects(verifySelfhostPromotionPolicy(root), /reduces the observation-day threshold/u);
});
