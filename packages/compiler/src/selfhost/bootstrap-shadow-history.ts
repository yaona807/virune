import { createHash } from 'node:crypto';
import type {
	PromotionEvidenceObservation,
	PromotionEvidenceStatus,
} from './promotion-evidence.js';
import type {
	BootstrapShadowReport,
	BootstrapShadowSectionSummary,
} from './bootstrap-shadow-report.js';

export const BOOTSTRAP_SHADOW_HISTORY_VERSION = 1 as const;

export interface BootstrapShadowHistoryEntryInputV1 {
	readonly version: typeof BOOTSTRAP_SHADOW_HISTORY_VERSION;
	readonly runId: string;
	readonly candidateSha: string;
	readonly completedAt: string;
	readonly report: BootstrapShadowReport;
	readonly reportSha256: string;
}

export interface BootstrapShadowHistoryInputV1 {
	readonly version: typeof BOOTSTRAP_SHADOW_HISTORY_VERSION;
	readonly candidateSha: string;
	readonly entries: readonly BootstrapShadowHistoryEntryInputV1[];
}

export interface BootstrapShadowHistoryEntryV1 {
	readonly runId: string;
	readonly completedAt: string;
	readonly reportSha256: string;
	readonly status: 'equivalent' | 'mismatch';
	readonly unexpectedDifferentials: number;
}

export interface BootstrapShadowHistoryV1 {
	readonly version: typeof BOOTSTRAP_SHADOW_HISTORY_VERSION;
	readonly candidateSha: string;
	readonly successfulRuns: number;
	readonly observationDays: number;
	readonly unexplainedDifferentials: number;
	readonly firstSuccessfulAt: string | null;
	readonly latestCompletedAt: string;
	readonly latestReportSha256: string;
	readonly entries: readonly BootstrapShadowHistoryEntryV1[];
}

export interface BootstrapShadowHistoryPayloadV1 {
	readonly history: BootstrapShadowHistoryV1;
	readonly observation: PromotionEvidenceObservation;
}

export interface BootstrapShadowHistoryResultV1 extends BootstrapShadowHistoryPayloadV1 {
	readonly serialized: string;
	readonly sha256: string;
}

export class BootstrapShadowHistoryError extends Error {
	public override readonly name = 'BootstrapShadowHistoryError';
	public constructor(public readonly path: string, message: string) {
		super(`${path}: ${message}`);
	}
}

const sha256Pattern = /^[0-9a-f]{64}$/u;
const candidateShaPattern = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const reportKeys = [
	'version',
	'mode',
	'blocking',
	'expectedDifferencePaths',
	'baseline',
	'candidate',
	'status',
	'rawArtifactEqual',
	'expectedChanges',
	'unexpectedChanges',
	'unexpectedSections',
] as const;

export function createBootstrapShadowHistory(value: unknown): BootstrapShadowHistoryResultV1 {
	const input = record(value, '$');
	exactKeys(input, ['version', 'candidateSha', 'entries'], '$');
	literal(input.version, BOOTSTRAP_SHADOW_HISTORY_VERSION, '$.version');
	const candidateSha = normalizedCandidateSha(input.candidateSha, '$.candidateSha');
	const entryValues = array(input.entries, '$.entries');
	if (entryValues.length === 0) throw new BootstrapShadowHistoryError('$.entries', 'at least one shadow report is required');

	const seenRunIds = new Set<string>();
	const entries = entryValues.map((entry, index) => parseEntry(entry, index, candidateSha, seenRunIds));
	for (let index = 1; index < entries.length; index += 1) {
		const previous = entries[index - 1]!;
		const current = entries[index]!;
		if (compareEntryOrder(previous, current) >= 0) {
			throw new BootstrapShadowHistoryError(
				`$.entries[${index}]`,
				'entries must be strictly ordered by completedAt and runId',
			);
		}
	}

	const trailing = trailingSuccessfulEntries(entries);
	const unexplainedDifferentials = entries.reduce(
		(total, entry) => total + entry.unexpectedDifferentials,
		0,
	);
	const latest = entries.at(-1)!;
	const evidenceStatus: PromotionEvidenceStatus = latest.status === 'equivalent' && unexplainedDifferentials === 0
		? 'passed'
		: 'failed';
	const history: BootstrapShadowHistoryV1 = {
		version: BOOTSTRAP_SHADOW_HISTORY_VERSION,
		candidateSha,
		successfulRuns: trailing.length,
		observationDays: distinctUtcDays(trailing),
		unexplainedDifferentials,
		firstSuccessfulAt: trailing[0]?.completedAt ?? null,
		latestCompletedAt: latest.completedAt,
		latestReportSha256: latest.reportSha256,
		entries,
	};
	const observation: PromotionEvidenceObservation = {
		schemaVersion: 1,
		candidateSha,
		successfulRuns: history.successfulRuns,
		observationDays: history.observationDays,
		unexplainedDifferentials,
		manualApproval: false,
		rollbackEvidence: false,
		stableReleaseCycles: 0,
		evidence: [{
			id: 'stage1-stage2',
			status: evidenceStatus,
			candidateSha,
			source: `bootstrap-shadow-report:${latest.reportSha256}`,
			completedAt: latest.completedAt,
		}],
	};
	const payload: BootstrapShadowHistoryPayloadV1 = { history, observation };
	const serialized = JSON.stringify(payload);
	return {
		...payload,
		serialized,
		sha256: sha256(serialized),
	};
}

function parseEntry(
	value: unknown,
	index: number,
	expectedCandidateSha: string,
	seenRunIds: Set<string>,
): BootstrapShadowHistoryEntryV1 {
	const path = `$.entries[${index}]`;
	const entry = record(value, path);
	exactKeys(entry, ['version', 'runId', 'candidateSha', 'completedAt', 'report', 'reportSha256'], path);
	literal(entry.version, BOOTSTRAP_SHADOW_HISTORY_VERSION, `${path}.version`);
	const runId = nonEmptyString(entry.runId, `${path}.runId`);
	if (seenRunIds.has(runId)) throw new BootstrapShadowHistoryError(`${path}.runId`, `duplicate runId ${runId}`);
	seenRunIds.add(runId);
	const candidateSha = normalizedCandidateSha(entry.candidateSha, `${path}.candidateSha`);
	if (candidateSha !== expectedCandidateSha) {
		throw new BootstrapShadowHistoryError(
			`${path}.candidateSha`,
			`expected ${expectedCandidateSha}, received ${candidateSha}`,
		);
	}
	const completedAt = canonicalTimestamp(entry.completedAt, `${path}.completedAt`);
	const reportSha256 = normalizedSha256(entry.reportSha256, `${path}.reportSha256`);
	const parsedReport = parseReport(entry.report, `${path}.report`);
	const canonicalSerialized = JSON.stringify(parsedReport.report);
	const calculatedSha256 = sha256(canonicalSerialized);
	if (calculatedSha256 !== reportSha256) {
		throw new BootstrapShadowHistoryError(
			`${path}.reportSha256`,
			`expected ${calculatedSha256}, received ${reportSha256}`,
		);
	}
	if (JSON.stringify(entry.report) !== canonicalSerialized) {
		throw new BootstrapShadowHistoryError(`${path}.report`, 'report is not in canonical version 1 property order');
	}
	return {
		runId,
		completedAt,
		reportSha256,
		status: parsedReport.report.status,
		unexpectedDifferentials: parsedReport.report.unexpectedChanges.length,
	};
}

function parseReport(value: unknown, path: string): { readonly report: BootstrapShadowReport } {
	const report = record(value, path);
	exactKeys(report, reportKeys, path);
	literal(report.version, 1, `${path}.version`);
	literal(report.mode, 'shadow', `${path}.mode`);
	literal(report.blocking, false, `${path}.blocking`);
	const expectedDifferencePaths = array(report.expectedDifferencePaths, `${path}.expectedDifferencePaths`);
	if (expectedDifferencePaths.length !== 1 || expectedDifferencePaths[0] !== 'metadata.stage') {
		throw new BootstrapShadowHistoryError(
			`${path}.expectedDifferencePaths`,
			'expected exactly metadata.stage',
		);
	}
	const baseline = parseSubject(report.baseline, `${path}.baseline`, 'stage1');
	const candidate = parseSubject(report.candidate, `${path}.candidate`, 'stage2');
	if (baseline.label === candidate.label) {
		throw new BootstrapShadowHistoryError(`${path}.candidate.label`, 'subject labels must be distinct');
	}
	const status = oneOf(report.status, ['equivalent', 'mismatch'] as const, `${path}.status`);
	const rawArtifactEqual = boolean(report.rawArtifactEqual, `${path}.rawArtifactEqual`);
	const expectedChanges = parseChanges(report.expectedChanges, `${path}.expectedChanges`);
	const unexpectedChanges = parseChanges(report.unexpectedChanges, `${path}.unexpectedChanges`);
	if (
		expectedChanges.length !== 1
		|| expectedChanges[0]!.section !== 'metadata'
		|| expectedChanges[0]!.path !== 'metadata.stage'
		|| expectedChanges[0]!.before !== JSON.stringify('stage1')
		|| expectedChanges[0]!.after !== JSON.stringify('stage2')
	) {
		throw new BootstrapShadowHistoryError(
			`${path}.expectedChanges`,
			'expected exactly the canonical stage1 to stage2 metadata.stage change',
		);
	}
	if (status !== (unexpectedChanges.length === 0 ? 'equivalent' : 'mismatch')) {
		throw new BootstrapShadowHistoryError(`${path}.status`, 'status does not match unexpectedChanges');
	}
	if (rawArtifactEqual) {
		throw new BootstrapShadowHistoryError(
			`${path}.rawArtifactEqual`,
			'equal artifacts cannot contain the canonical stage change',
		);
	}
	const unexpectedSections = parseSections(report.unexpectedSections, `${path}.unexpectedSections`);
	const expectedSections = summarizeSections(unexpectedChanges);
	if (JSON.stringify(unexpectedSections) !== JSON.stringify(expectedSections)) {
		throw new BootstrapShadowHistoryError(
			`${path}.unexpectedSections`,
			'unexpectedSections does not match unexpectedChanges',
		);
	}
	const canonicalReport: BootstrapShadowReport = {
		version: 1,
		mode: 'shadow',
		blocking: false,
		expectedDifferencePaths: ['metadata.stage'],
		baseline,
		candidate,
		status,
		rawArtifactEqual,
		expectedChanges,
		unexpectedChanges,
		unexpectedSections,
	};
	return { report: canonicalReport };
}

function parseSubject(
	value: unknown,
	path: string,
	expectedStage: 'stage1' | 'stage2',
): BootstrapShadowReport['baseline'] {
	const subject = record(value, path);
	exactKeys(subject, ['label', 'stage', 'compilerVersion', 'artifactSha256'], path);
	const label = nonEmptyString(subject.label, `${path}.label`);
	literal(subject.stage, expectedStage, `${path}.stage`);
	const compilerVersion = nonEmptyString(subject.compilerVersion, `${path}.compilerVersion`);
	const artifactSha256 = normalizedSha256(subject.artifactSha256, `${path}.artifactSha256`);
	return { label, stage: expectedStage, compilerVersion, artifactSha256 };
}

type ShadowChange = BootstrapShadowReport['unexpectedChanges'][number];

function parseChanges(value: unknown, path: string): readonly ShadowChange[] {
	const values = array(value, path);
	const changes = values.map((item, index): ShadowChange => {
		const itemPath = `${path}[${index}]`;
		const change = record(item, itemPath);
		exactKeys(change, ['section', 'path', 'before', 'after'], itemPath);
		return {
			section: nonEmptyString(change.section, `${itemPath}.section`),
			path: nonEmptyString(change.path, `${itemPath}.path`),
			before: string(change.before, `${itemPath}.before`),
			after: string(change.after, `${itemPath}.after`),
		};
	});
	for (let index = 1; index < changes.length; index += 1) {
		if (compareChange(changes[index - 1]!, changes[index]!) >= 0) {
			throw new BootstrapShadowHistoryError(`${path}[${index}]`, 'changes must be strictly ordered');
		}
	}
	return changes;
}

function parseSections(value: unknown, path: string): readonly BootstrapShadowSectionSummary[] {
	const values = array(value, path);
	const sections = values.map((item, index): BootstrapShadowSectionSummary => {
		const itemPath = `${path}[${index}]`;
		const section = record(item, itemPath);
		exactKeys(section, ['section', 'count'], itemPath);
		return {
			section: nonEmptyString(section.section, `${itemPath}.section`),
			count: positiveSafeInteger(section.count, `${itemPath}.count`),
		};
	});
	for (let index = 1; index < sections.length; index += 1) {
		if (sections[index - 1]!.section >= sections[index]!.section) {
			throw new BootstrapShadowHistoryError(`${path}[${index}].section`, 'sections must be strictly ordered');
		}
	}
	return sections;
}

function summarizeSections(changes: readonly ShadowChange[]): readonly BootstrapShadowSectionSummary[] {
	const counts = new Map<string, number>();
	for (const change of changes) counts.set(change.section, (counts.get(change.section) ?? 0) + 1);
	return [...counts.entries()]
		.sort(([left], [right]) => compareText(left, right))
		.map(([section, count]) => ({ section, count }));
}

function trailingSuccessfulEntries(
	entries: readonly BootstrapShadowHistoryEntryV1[],
): readonly BootstrapShadowHistoryEntryV1[] {
	let first = entries.length;
	for (let index = entries.length - 1; index >= 0; index -= 1) {
		if (entries[index]!.status !== 'equivalent') break;
		first = index;
	}
	return entries.slice(first);
}

function distinctUtcDays(entries: readonly BootstrapShadowHistoryEntryV1[]): number {
	return new Set(entries.map(entry => entry.completedAt.slice(0, 10))).size;
}

function compareEntryOrder(left: BootstrapShadowHistoryEntryV1, right: BootstrapShadowHistoryEntryV1): number {
	return compareText(left.completedAt, right.completedAt) || compareText(left.runId, right.runId);
}

function compareChange(left: ShadowChange, right: ShadowChange): number {
	return compareText(left.section, right.section)
		|| compareText(left.path, right.path)
		|| compareText(left.before, right.before)
		|| compareText(left.after, right.after);
}

function record(value: unknown, path: string): Record<string, unknown> {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		throw new BootstrapShadowHistoryError(path, 'expected an object');
	}
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) {
		throw new BootstrapShadowHistoryError(path, 'expected a plain data object');
	}
	return value as Record<string, unknown>;
}

function array(value: unknown, path: string): readonly unknown[] {
	if (!Array.isArray(value)) throw new BootstrapShadowHistoryError(path, 'expected an array');
	return value;
}

function string(value: unknown, path: string): string {
	if (typeof value !== 'string') throw new BootstrapShadowHistoryError(path, 'expected a string');
	return value;
}

function nonEmptyString(value: unknown, path: string): string {
	const result = string(value, path);
	if (result.length === 0) throw new BootstrapShadowHistoryError(path, 'expected a non-empty string');
	return result;
}

function boolean(value: unknown, path: string): boolean {
	if (typeof value !== 'boolean') throw new BootstrapShadowHistoryError(path, 'expected a boolean');
	return value;
}

function positiveSafeInteger(value: unknown, path: string): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
		throw new BootstrapShadowHistoryError(path, 'expected a positive safe integer');
	}
	return value;
}

function normalizedSha256(value: unknown, path: string): string {
	const result = string(value, path);
	if (!sha256Pattern.test(result)) throw new BootstrapShadowHistoryError(path, 'expected a lowercase SHA-256 value');
	return result;
}

function normalizedCandidateSha(value: unknown, path: string): string {
	const result = string(value, path);
	if (!candidateShaPattern.test(result)) {
		throw new BootstrapShadowHistoryError(path, 'expected a lowercase 40- or 64-character hexadecimal SHA');
	}
	return result;
}

function canonicalTimestamp(value: unknown, path: string): string {
	const result = string(value, path);
	const date = new Date(result);
	if (Number.isNaN(date.getTime()) || date.toISOString() !== result) {
		throw new BootstrapShadowHistoryError(path, 'expected a canonical ISO timestamp');
	}
	return result;
}

function literal<T extends string | number | boolean>(value: unknown, expected: T, path: string): T {
	if (value !== expected) throw new BootstrapShadowHistoryError(path, `expected ${JSON.stringify(expected)}`);
	return expected;
}

function oneOf<const T extends readonly string[]>(value: unknown, allowed: T, path: string): T[number] {
	if (typeof value !== 'string' || !allowed.includes(value)) {
		throw new BootstrapShadowHistoryError(path, `expected one of ${allowed.join(', ')}`);
	}
	return value as T[number];
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], path: string): void {
	const allowedSet = new Set(allowed);
	for (const key of Object.keys(value)) {
		if (!allowedSet.has(key)) throw new BootstrapShadowHistoryError(`${path}.${key}`, 'unknown property');
	}
	for (const key of allowed) {
		if (!Object.hasOwn(value, key)) throw new BootstrapShadowHistoryError(`${path}.${key}`, 'missing property');
	}
}

function sha256(value: string): string {
	return createHash('sha256').update(value, 'utf8').digest('hex');
}

function compareText(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}
