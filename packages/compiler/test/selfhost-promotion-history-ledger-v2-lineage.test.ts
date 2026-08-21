import assert from 'node:assert/strict';
import test from 'node:test';
import {
	createPromotionHistoryLedgerV2,
	parsePromotionHistoryLedgerV2,
	promotionHistoryMigrationV2,
	type PromotionHistoryLedgerInputV2,
} from '../src/selfhost/promotion-history-ledger-v2.js';

const digest = (character: string): string => character.repeat(64);

function emptyLedger(generation: number, parentLedgerSha256: string | null): PromotionHistoryLedgerInputV2 {
	return {
		version: 2,
		stage: 'required-selfhost',
		generation,
		parentLedgerSha256,
		migration: promotionHistoryMigrationV2(),
		runs: [],
	};
}

test('a retained generation-2 parent is structurally verifiable without replaying generation 1', () => {
	const generation1 = createPromotionHistoryLedgerV2(emptyLedger(1, null));
	const generation2 = createPromotionHistoryLedgerV2(emptyLedger(2, generation1.sha256), generation1.ledger);
	const retainedParent = parsePromotionHistoryLedgerV2(generation2.ledger);
	assert.equal(retainedParent.sha256, generation2.sha256);
	const generation3 = createPromotionHistoryLedgerV2(emptyLedger(3, generation2.sha256), retainedParent.ledger);
	assert.equal(generation3.ledger.generation, 3);
});

test('non-genesis ledgers still fail closed when parent hash is absent or malformed', () => {
	assert.throws(() => parsePromotionHistoryLedgerV2(emptyLedger(2, null)), /non-genesis ledger must identify its parent/u);
	assert.throws(() => parsePromotionHistoryLedgerV2(emptyLedger(2, digest('A'))), /lowercase 64-character SHA-256/u);
});
