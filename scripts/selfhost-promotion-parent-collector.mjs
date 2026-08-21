import { artifactByExactName } from './selfhost-promotion-github.mjs';

export const PROMOTION_AGGREGATION_WORKFLOW = 'selfhost-promotion-history-aggregation.yml';
export const PROMOTION_AGGREGATION_REPORT_PREFIX = 'selfhost-promotion-history-report';
export const PROMOTION_AGGREGATION_LEDGER_PREFIX = 'selfhost-promotion-history-ledger';
export const PROMOTION_AGGREGATION_REPORT_FILE = 'aggregation-report.json';
export const PROMOTION_AGGREGATION_LEDGER_FILE = 'promotion-history-ledger.json';

export async function createPromotionParentCandidates({ reader, inventory, currentAggregationRunId, currentAggregationAttempt }) {
	if (!Array.isArray(inventory)) throw new TypeError('inventory must be an array');
	const currentRunId = canonicalRunId(currentAggregationRunId);
	if (!Number.isSafeInteger(currentAggregationAttempt) || currentAggregationAttempt <= 0) throw new TypeError('currentAggregationAttempt must be a positive safe integer');
	const candidates = [];
	for (const run of inventory) {
		for (const attempt of run.attempts) {
			if (run.runId === currentRunId && attempt.attempt >= currentAggregationAttempt) continue;
			let report = null;
			let ledger = null;
			if (attempt.conclusion === 'success') {
				const reportMetadata = artifactByExactName(run.artifacts, `${PROMOTION_AGGREGATION_REPORT_PREFIX}-${run.runId}-${attempt.attempt}`);
				const ledgerMetadata = artifactByExactName(run.artifacts, `${PROMOTION_AGGREGATION_LEDGER_PREFIX}-${run.runId}-${attempt.attempt}`);
				if (reportMetadata !== null && !reportMetadata.expired) {
					const downloaded = await reader.downloadCanonicalJsonArtifact({ artifact: reportMetadata, expectedFileName: PROMOTION_AGGREGATION_REPORT_FILE });
					report = downloaded.value;
				}
				if (ledgerMetadata !== null && !ledgerMetadata.expired) {
					const downloaded = await reader.downloadCanonicalJsonArtifact({ artifact: ledgerMetadata, expectedFileName: PROMOTION_AGGREGATION_LEDGER_FILE });
					ledger = downloaded.value;
				}
			}
			candidates.push({
				runId: run.runId,
				attempt: attempt.attempt,
				createdAt: run.createdAt,
				conclusion: attempt.conclusion,
				report,
				ledger,
			});
		}
	}
	return candidates.sort(compareCandidateNewestFirst);
}

function canonicalRunId(value) {
	const text = typeof value === 'number' ? String(value) : value;
	if (typeof text !== 'string' || !/^[1-9][0-9]*$/u.test(text)) throw new TypeError('currentAggregationRunId must be a canonical positive decimal run ID');
	return text;
}

function compareCandidateNewestFirst(left, right) {
	if (left.createdAt !== right.createdAt) return left.createdAt > right.createdAt ? -1 : 1;
	const leftId = BigInt(left.runId);
	const rightId = BigInt(right.runId);
	if (leftId !== rightId) return leftId > rightId ? -1 : 1;
	return right.attempt - left.attempt;
}
