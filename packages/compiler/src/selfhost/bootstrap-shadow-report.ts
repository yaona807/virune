import { createHash } from 'node:crypto';
import {
	diffBootstrapArtifacts,
	type BootstrapArtifactDiffEntry,
	type NormalizedBootstrapArtifactResult,
} from './bootstrap-artifact-normalizer.js';

export const BOOTSTRAP_SHADOW_REPORT_VERSION = 1 as const;

export type BootstrapShadowStage = 'stage0' | 'stage1' | 'stage2';

export interface BootstrapShadowSubject {
	readonly label: string;
	readonly stage: BootstrapShadowStage;
	readonly compilerVersion: string;
	readonly artifact: NormalizedBootstrapArtifactResult;
}

export interface BootstrapShadowReportInput {
	readonly baseline: BootstrapShadowSubject;
	readonly candidate: BootstrapShadowSubject;
}

export interface BootstrapShadowReportSubject {
	readonly label: string;
	readonly stage: BootstrapShadowStage;
	readonly compilerVersion: string;
	readonly artifactSha256: string;
}

export interface BootstrapShadowSectionSummary {
	readonly section: string;
	readonly count: number;
}

export interface BootstrapShadowReport {
	readonly version: typeof BOOTSTRAP_SHADOW_REPORT_VERSION;
	readonly mode: 'shadow';
	readonly blocking: false;
	readonly expectedDifferencePaths: readonly ['metadata.stage'];
	readonly baseline: BootstrapShadowReportSubject;
	readonly candidate: BootstrapShadowReportSubject;
	readonly status: 'equivalent' | 'mismatch';
	readonly rawArtifactEqual: boolean;
	readonly expectedChanges: readonly BootstrapArtifactDiffEntry[];
	readonly unexpectedChanges: readonly BootstrapArtifactDiffEntry[];
	readonly unexpectedSections: readonly BootstrapShadowSectionSummary[];
}

export interface BootstrapShadowReportResult {
	readonly report: BootstrapShadowReport;
	readonly serialized: string;
	readonly sha256: string;
}

const sha256Pattern = /^[0-9a-f]{64}$/u;

export function createBootstrapShadowReport(input: BootstrapShadowReportInput): BootstrapShadowReportResult {
	const baseline = normalizeSubject(input.baseline, 'baseline');
	const candidate = normalizeSubject(input.candidate, 'candidate');
	if (baseline.label === candidate.label) throw new Error('Shadow subject labels must be distinct');
	verifyArtifact(input.baseline.artifact, 'baseline.artifact');
	verifyArtifact(input.candidate.artifact, 'candidate.artifact');

	const diff = diffBootstrapArtifacts(input.baseline.artifact, input.candidate.artifact);
	const sortedChanges = [...diff.changes].sort(compareChange);
	const expectedChanges: BootstrapArtifactDiffEntry[] = [];
	const unexpectedChanges: BootstrapArtifactDiffEntry[] = [];
	for (const change of sortedChanges) {
		if (isExpectedStageChange(change, baseline.stage, candidate.stage)) expectedChanges.push(change);
		else unexpectedChanges.push(change);
	}
	const report: BootstrapShadowReport = {
		version: BOOTSTRAP_SHADOW_REPORT_VERSION,
		mode: 'shadow',
		blocking: false,
		expectedDifferencePaths: ['metadata.stage'],
		baseline,
		candidate,
		status: unexpectedChanges.length === 0 ? 'equivalent' : 'mismatch',
		rawArtifactEqual: diff.equal,
		expectedChanges,
		unexpectedChanges,
		unexpectedSections: summarizeSections(unexpectedChanges),
	};
	const serialized = JSON.stringify(report);
	return {
		report,
		serialized,
		sha256: sha256(serialized),
	};
}

function normalizeSubject(subject: BootstrapShadowSubject, path: string): BootstrapShadowReportSubject {
	assertNonEmpty(subject.label, `${path}.label`);
	assertNonEmpty(subject.compilerVersion, `${path}.compilerVersion`);
	if (subject.stage !== 'stage0' && subject.stage !== 'stage1' && subject.stage !== 'stage2') {
		throw new Error(`${path}.stage is invalid`);
	}
	return {
		label: subject.label,
		stage: subject.stage,
		compilerVersion: subject.compilerVersion,
		artifactSha256: subject.artifact.sha256,
	};
}

function verifyArtifact(artifact: NormalizedBootstrapArtifactResult, path: string): void {
	if (!sha256Pattern.test(artifact.sha256)) throw new Error(`${path}.sha256 is invalid`);
	const calculated = sha256(artifact.serialized);
	if (calculated !== artifact.sha256) throw new Error(`${path}.sha256 does not match serialized content`);
	if (JSON.stringify(artifact.artifact) !== artifact.serialized) {
		throw new Error(`${path}.artifact does not match serialized content`);
	}
}

function isExpectedStageChange(
	change: BootstrapArtifactDiffEntry,
	baselineStage: BootstrapShadowStage,
	candidateStage: BootstrapShadowStage,
): boolean {
	return change.path === 'metadata.stage'
		&& change.before === JSON.stringify(baselineStage)
		&& change.after === JSON.stringify(candidateStage);
}

function summarizeSections(changes: readonly BootstrapArtifactDiffEntry[]): readonly BootstrapShadowSectionSummary[] {
	const counts = new Map<string, number>();
	for (const change of changes) counts.set(change.section, (counts.get(change.section) ?? 0) + 1);
	return [...counts.entries()]
		.sort(([left], [right]) => compareText(left, right))
		.map(([section, count]) => ({ section, count }));
}

function compareChange(left: BootstrapArtifactDiffEntry, right: BootstrapArtifactDiffEntry): number {
	return compareText(left.section, right.section)
		|| compareText(left.path, right.path)
		|| compareText(left.before, right.before)
		|| compareText(left.after, right.after);
}

function assertNonEmpty(value: string, path: string): void {
	if (value.length === 0) throw new Error(`${path} must not be empty`);
}

function sha256(value: string): string {
	return createHash('sha256').update(value).digest('hex');
}

function compareText(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}
