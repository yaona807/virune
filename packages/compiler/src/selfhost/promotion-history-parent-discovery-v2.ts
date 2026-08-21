import { parsePromotionHistoryAggregationReportV2 } from './promotion-history-aggregation-report-v2.js';
import { parsePromotionHistoryLedgerV2, type PromotionHistoryLedgerResultV2 } from './promotion-history-ledger-v2.js';
import type { PromotionHistoryAggregationReportV2 } from './promotion-history-orchestrator-v2.js';
import type { PromotionSubjectStage } from './promotion-subject.js';

export interface PromotionHistoryAggregationCandidateV2 {
	readonly runId: string;
	readonly attempt: number;
	readonly createdAt: string;
	readonly conclusion: string;
	readonly report: unknown | null;
	readonly ledger: unknown | null;
}

export interface PromotionHistoryParentDiscoveryV2 {
	readonly parent: PromotionHistoryLedgerResultV2 | null;
	readonly sourceRunId: string | null;
	readonly sourceAttempt: number | null;
	readonly expectedLedgerSha256: string | null;
	readonly expectedGeneration: number | null;
}

export class PromotionHistoryParentDiscoveryError extends Error {
	public override readonly name = 'PromotionHistoryParentDiscoveryError';
	public constructor(public readonly path: string, message: string) {
		super(`${path}: ${message}`);
	}
}

const runIdPattern = /^[1-9][0-9]*$/u;
const timestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

export function discoverPromotionHistoryParentV2(input: {
	readonly stage: PromotionSubjectStage;
	readonly candidates: readonly PromotionHistoryAggregationCandidateV2[];
}): PromotionHistoryParentDiscoveryV2 {
	const candidates = parseCandidates(input.candidates);
	let expectedLedgerSha256: string | null = null;
	let expectedGeneration: number | null = null;
	let sawNewerNoLedgerReport = false;

	for (let index = 0; index < candidates.length; index += 1) {
		const candidate = candidates[index]!;
		if (candidate.conclusion !== 'success') continue;
		if (candidate.report === null) {
			throw new PromotionHistoryParentDiscoveryError(`candidates[${index}].report`, 'successful aggregation attempt must retain its canonical report');
		}
		const parsedReport = parsePromotionHistoryAggregationReportV2(candidate.report);
		const report = parsedReport.report;
		if (report.stage !== input.stage) {
			throw new PromotionHistoryParentDiscoveryError(`candidates[${index}].report.stage`, `expected ${input.stage}, received ${report.stage}`);
		}
		if (report.trigger.aggregationRunId !== candidate.runId || report.trigger.aggregationAttempt !== candidate.attempt) {
			throw new PromotionHistoryParentDiscoveryError(`candidates[${index}].report.trigger`, 'report trigger does not match the aggregation attempt that retained it');
		}
		validateReportLineageShape(report, index);

		if (report.currentLedgerSha256 === null) {
			if (report.publish || candidate.ledger !== null) {
				throw new PromotionHistoryParentDiscoveryError(`candidates[${index}]`, 'report without current ledger cannot publish or retain a ledger artifact');
			}
			if (expectedLedgerSha256 === null) sawNewerNoLedgerReport = true;
			continue;
		}
		if (sawNewerNoLedgerReport && expectedLedgerSha256 === null) {
			throw new PromotionHistoryParentDiscoveryError(
				`candidates[${index}].report.currentLedgerSha256`,
				'newer successful aggregation report dropped previously published ledger state',
			);
		}

		if (candidate.attempt !== 1) {
			if (report.publish || candidate.ledger !== null) {
				throw new PromotionHistoryParentDiscoveryError(`candidates[${index}]`, 'aggregation rerun attempts are diagnostic and cannot publish canonical ledger state');
			}
			if (expectedLedgerSha256 === null) {
				expectedLedgerSha256 = report.currentLedgerSha256;
				expectedGeneration = report.currentLedgerGeneration;
			} else if (
				report.currentLedgerSha256 !== expectedLedgerSha256
				|| report.currentLedgerGeneration !== expectedGeneration
			) {
				throw new PromotionHistoryParentDiscoveryError(
					`candidates[${index}].report.currentLedgerSha256`,
					'aggregation rerun report disagrees with the retained current-ledger lineage',
				);
			}
			continue;
		}

		if (expectedLedgerSha256 === null) {
			expectedLedgerSha256 = report.currentLedgerSha256;
			expectedGeneration = report.currentLedgerGeneration;
		} else if (report.currentLedgerSha256 !== expectedLedgerSha256 || report.currentLedgerGeneration !== expectedGeneration) {
			throw new PromotionHistoryParentDiscoveryError(
				`candidates[${index}].report.currentLedgerSha256`,
				'aggregation reports disagree about the current ledger while searching for its publishing source',
			);
		}

		if (!report.publish) {
			if (candidate.ledger !== null) {
				throw new PromotionHistoryParentDiscoveryError(`candidates[${index}].ledger`, 'non-publishing aggregation attempt cannot retain a canonical ledger artifact');
			}
			continue;
		}
		if (candidate.ledger === null) {
			throw new PromotionHistoryParentDiscoveryError(`candidates[${index}].ledger`, 'publishing aggregation attempt is missing its canonical ledger artifact');
		}
		const parsedLedger = parsePromotionHistoryLedgerV2(candidate.ledger);
		if (parsedLedger.ledger.stage !== input.stage) {
			throw new PromotionHistoryParentDiscoveryError(`candidates[${index}].ledger.stage`, `expected ${input.stage}, received ${parsedLedger.ledger.stage}`);
		}
		if (parsedLedger.sha256 !== report.publishedLedgerSha256 || parsedLedger.sha256 !== expectedLedgerSha256) {
			throw new PromotionHistoryParentDiscoveryError(`candidates[${index}].ledger`, 'ledger SHA does not match the aggregation report lineage');
		}
		if (parsedLedger.ledger.generation !== report.currentLedgerGeneration || parsedLedger.ledger.generation !== expectedGeneration) {
			throw new PromotionHistoryParentDiscoveryError(`candidates[${index}].ledger.generation`, 'ledger generation does not match the aggregation report lineage');
		}
		return {
			parent: parsedLedger,
			sourceRunId: candidate.runId,
			sourceAttempt: candidate.attempt,
			expectedLedgerSha256,
			expectedGeneration,
		};
	}

	if (expectedLedgerSha256 !== null) {
		throw new PromotionHistoryParentDiscoveryError('candidates', 'current ledger is referenced by retained reports but no valid publishing source artifact is available');
	}
	return { parent: null, sourceRunId: null, sourceAttempt: null, expectedLedgerSha256: null, expectedGeneration: null };
}

function validateReportLineageShape(report: PromotionHistoryAggregationReportV2, index: number): void {
	const path = `candidates[${index}].report`;
	if (report.currentLedgerSha256 === null) {
		if (report.parentLedgerSha256 !== null) {
			throw new PromotionHistoryParentDiscoveryError(`${path}.parentLedgerSha256`, 'report without current ledger cannot retain a parent ledger SHA');
		}
		return;
	}
	if (!report.publish) {
		if (report.parentLedgerSha256 !== report.currentLedgerSha256) {
			throw new PromotionHistoryParentDiscoveryError(`${path}.parentLedgerSha256`, 'non-publishing report must retain the current ledger as its parent');
		}
		return;
	}
	if (report.currentLedgerGeneration === 1 && report.parentLedgerSha256 !== null) {
		throw new PromotionHistoryParentDiscoveryError(`${path}.parentLedgerSha256`, 'generation 1 publishing report must not identify a parent ledger');
	}
	if (report.currentLedgerGeneration !== null && report.currentLedgerGeneration > 1 && report.parentLedgerSha256 === null) {
		throw new PromotionHistoryParentDiscoveryError(`${path}.parentLedgerSha256`, 'non-genesis publishing report must identify its parent ledger');
	}
}

function parseCandidates(values: readonly PromotionHistoryAggregationCandidateV2[]): readonly PromotionHistoryAggregationCandidateV2[] {
	const seen = new Set<string>();
	const parsed = values.map((value, index) => {
		if (!runIdPattern.test(value.runId)) throw new PromotionHistoryParentDiscoveryError(`candidates[${index}].runId`, 'expected canonical positive decimal run ID');
		if (!Number.isSafeInteger(value.attempt) || value.attempt <= 0) throw new PromotionHistoryParentDiscoveryError(`candidates[${index}].attempt`, 'expected positive safe integer');
		if (!timestampPattern.test(value.createdAt) || new Date(value.createdAt).toISOString() !== value.createdAt) {
			throw new PromotionHistoryParentDiscoveryError(`candidates[${index}].createdAt`, 'expected canonical ISO timestamp');
		}
		if (typeof value.conclusion !== 'string' || value.conclusion.length === 0 || value.conclusion.trim() !== value.conclusion) {
			throw new PromotionHistoryParentDiscoveryError(`candidates[${index}].conclusion`, 'expected non-empty canonical conclusion');
		}
		const identity = `${value.runId}/${value.attempt}`;
		if (seen.has(identity)) throw new PromotionHistoryParentDiscoveryError(`candidates[${index}]`, `duplicate aggregation attempt ${identity}`);
		seen.add(identity);
		return value;
	});
	for (let index = 1; index < parsed.length; index += 1) {
		if (compareCandidates(parsed[index - 1]!, parsed[index]!) <= 0) {
			throw new PromotionHistoryParentDiscoveryError(`candidates[${index}]`, 'candidates must be strictly newest-first by createdAt, runId, and attempt');
		}
	}
	return parsed;
}

function compareCandidates(left: PromotionHistoryAggregationCandidateV2, right: PromotionHistoryAggregationCandidateV2): number {
	if (left.createdAt !== right.createdAt) return left.createdAt < right.createdAt ? -1 : 1;
	const leftRun = BigInt(left.runId);
	const rightRun = BigInt(right.runId);
	if (leftRun !== rightRun) return leftRun < rightRun ? -1 : 1;
	return left.attempt < right.attempt ? -1 : left.attempt > right.attempt ? 1 : 0;
}
