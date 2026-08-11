export const EXPERIMENTAL_SEMANTIC_SNAPSHOT_VERSION = 1 as const;

export type SemanticEvidencePlatform = 'node' | 'browser' | 'neutral';
export type SemanticCoverageStatus = 'modeled' | 'partial' | 'opaque' | 'unknown';
export type SemanticReachability = 'yes' | 'no' | 'unknown';
export type SemanticInteropTier = 'direct' | 'adapter' | 'host' | 'unsafe' | 'unknown';

export interface SemanticInputClosureV1 {
	readonly languageVersion: string;
	readonly platform: SemanticEvidencePlatform;
	readonly profile: string;
	readonly analyzerSha256: string;
	readonly sourceManifestSha256: string;
	readonly interopManifestSha256: string | null;
	readonly configurationSha256: string | null;
}

export interface SemanticSourceEvidenceV1 {
	readonly sourcePath: string;
	readonly startOffset: number;
	readonly endOffset: number;
}

export interface SemanticPublicAbiFactV1 {
	readonly symbol: string;
	readonly declarationKind: string;
	readonly signature: string;
}

export interface SemanticInteropFactV1 {
	readonly specifier: string;
	readonly tier: SemanticInteropTier;
	readonly assumptions: readonly string[];
}

export interface SemanticRootInputV1 {
	readonly root: string;
	readonly coverage: SemanticCoverageStatus;
	readonly limitations: readonly string[];
	readonly implementationSha256: string;
	readonly sourceEvidence: readonly SemanticSourceEvidenceV1[];
	readonly publicAbi: readonly SemanticPublicAbiFactV1[];
	readonly directEffects: readonly string[];
	readonly transitiveEffects: readonly string[];
	readonly interop: readonly SemanticInteropFactV1[];
	readonly reachableFailures: readonly string[];
	readonly panic: SemanticReachability;
	readonly discard: SemanticReachability;
}

export interface SemanticSnapshotInputV1 {
	readonly closure: SemanticInputClosureV1;
	readonly roots: readonly SemanticRootInputV1[];
}

export interface SemanticCoverageSummaryV1 {
	readonly enumeratedRoots: number;
	readonly modeled: number;
	readonly partial: number;
	readonly opaque: number;
	readonly unknown: number;
	readonly allEnumeratedRootsModeled: boolean;
}

export type SemanticRootSnapshotV1 = SemanticRootInputV1;

export interface ExperimentalSemanticSnapshotV1 {
	readonly version: typeof EXPERIMENTAL_SEMANTIC_SNAPSHOT_VERSION;
	readonly experimental: true;
	readonly closure: SemanticInputClosureV1;
	readonly coverage: SemanticCoverageSummaryV1;
	readonly roots: readonly SemanticRootSnapshotV1[];
}

export class SemanticSnapshotError extends Error {
	public override readonly name = 'SemanticSnapshotError';
	public constructor(public readonly path: string, message: string) {
		super(`${path}: ${message}`);
	}
}

const SHA256_PATTERN = /^[0-9a-f]{64}$/u;

/**
 * Build the experimental Semantic Change Evidence snapshot without assigning
 * safety meaning to missing facts. Every enumerated root carries an explicit
 * coverage state, and partial/opaque/unknown roots must explain their
 * limitation. The coverage summary is deliberately scoped to enumerated roots;
 * it does not claim that the analyzer enumerated every relevant program root.
 *
 * This module is intentionally internal and experimental. It is not a stable
 * Compiler API or artifact-schema compatibility promise.
 */
export function createExperimentalSemanticSnapshot(
	input: SemanticSnapshotInputV1,
): ExperimentalSemanticSnapshotV1 {
	const closure = canonicalClosure(input.closure);
	const roots = input.roots.map((root, index) => canonicalRoot(root, `$.roots[${index}]`));
	roots.sort((left, right) => compareText(left.root, right.root));
	assertUnique(roots.map(root => root.root), '$.roots', 'root');
	return {
		version: EXPERIMENTAL_SEMANTIC_SNAPSHOT_VERSION,
		experimental: true,
		closure,
		coverage: summarizeCoverage(roots),
		roots,
	};
}

export function serializeExperimentalSemanticSnapshot(snapshot: ExperimentalSemanticSnapshotV1): string {
	return JSON.stringify(snapshot);
}

function canonicalClosure(value: SemanticInputClosureV1): SemanticInputClosureV1 {
	return {
		languageVersion: nonEmptyText(value.languageVersion, '$.closure.languageVersion'),
		platform: oneOf(value.platform, ['node', 'browser', 'neutral'] as const, '$.closure.platform'),
		profile: nonEmptyText(value.profile, '$.closure.profile'),
		analyzerSha256: sha256(value.analyzerSha256, '$.closure.analyzerSha256'),
		sourceManifestSha256: sha256(value.sourceManifestSha256, '$.closure.sourceManifestSha256'),
		interopManifestSha256: nullableSha256(value.interopManifestSha256, '$.closure.interopManifestSha256'),
		configurationSha256: nullableSha256(value.configurationSha256, '$.closure.configurationSha256'),
	};
}

function canonicalRoot(value: SemanticRootInputV1, path: string): SemanticRootSnapshotV1 {
	const coverage = oneOf(value.coverage, ['modeled', 'partial', 'opaque', 'unknown'] as const, `${path}.coverage`);
	const limitations = canonicalTextSet(value.limitations, `${path}.limitations`);
	if (coverage !== 'modeled' && limitations.length === 0) {
		throw new SemanticSnapshotError(`${path}.limitations`, `${coverage} coverage requires at least one explicit limitation`);
	}
	return {
		root: nonEmptyText(value.root, `${path}.root`),
		coverage,
		limitations,
		implementationSha256: sha256(value.implementationSha256, `${path}.implementationSha256`),
		sourceEvidence: canonicalSourceEvidence(value.sourceEvidence, `${path}.sourceEvidence`),
		publicAbi: canonicalPublicAbi(value.publicAbi, `${path}.publicAbi`),
		directEffects: canonicalTextSet(value.directEffects, `${path}.directEffects`),
		transitiveEffects: canonicalTextSet(value.transitiveEffects, `${path}.transitiveEffects`),
		interop: canonicalInterop(value.interop, `${path}.interop`),
		reachableFailures: canonicalTextSet(value.reachableFailures, `${path}.reachableFailures`),
		panic: oneOf(value.panic, ['yes', 'no', 'unknown'] as const, `${path}.panic`),
		discard: oneOf(value.discard, ['yes', 'no', 'unknown'] as const, `${path}.discard`),
	};
}

function canonicalSourceEvidence(
	values: readonly SemanticSourceEvidenceV1[],
	path: string,
): readonly SemanticSourceEvidenceV1[] {
	if (!Array.isArray(values)) throw new SemanticSnapshotError(path, 'expected an array');
	const result = values.map((value, index) => {
		const itemPath = `${path}[${index}]`;
		const startOffset = nonNegativeInteger(value.startOffset, `${itemPath}.startOffset`);
		const endOffset = nonNegativeInteger(value.endOffset, `${itemPath}.endOffset`);
		if (endOffset < startOffset) throw new SemanticSnapshotError(`${itemPath}.endOffset`, 'must be >= startOffset');
		return {
			sourcePath: normalizedSourcePath(value.sourcePath, `${itemPath}.sourcePath`),
			startOffset,
			endOffset,
		};
	});
	result.sort((left, right) => compareTuple(
		[left.sourcePath, numericKey(left.startOffset), numericKey(left.endOffset)],
		[right.sourcePath, numericKey(right.startOffset), numericKey(right.endOffset)],
	));
	assertUnique(
		result.map(item => `${item.sourcePath}\u0000${item.startOffset}\u0000${item.endOffset}`),
		path,
		'source evidence',
	);
	return result;
}

function canonicalPublicAbi(
	values: readonly SemanticPublicAbiFactV1[],
	path: string,
): readonly SemanticPublicAbiFactV1[] {
	if (!Array.isArray(values)) throw new SemanticSnapshotError(path, 'expected an array');
	const result = values.map((value, index) => ({
		symbol: nonEmptyText(value.symbol, `${path}[${index}].symbol`),
		declarationKind: nonEmptyText(value.declarationKind, `${path}[${index}].declarationKind`),
		signature: nonEmptyText(value.signature, `${path}[${index}].signature`),
	}));
	result.sort((left, right) => compareTuple(
		[left.symbol, left.declarationKind, left.signature],
		[right.symbol, right.declarationKind, right.signature],
	));
	assertUnique(
		result.map(item => `${item.symbol}\u0000${item.declarationKind}\u0000${item.signature}`),
		path,
		'public ABI fact',
	);
	return result;
}

function canonicalInterop(values: readonly SemanticInteropFactV1[], path: string): readonly SemanticInteropFactV1[] {
	if (!Array.isArray(values)) throw new SemanticSnapshotError(path, 'expected an array');
	const result = values.map((value, index) => ({
		specifier: nonEmptyText(value.specifier, `${path}[${index}].specifier`),
		tier: oneOf(value.tier, ['direct', 'adapter', 'host', 'unsafe', 'unknown'] as const, `${path}[${index}].tier`),
		assumptions: canonicalTextSet(value.assumptions, `${path}[${index}].assumptions`),
	}));
	result.sort((left, right) => compareText(left.specifier, right.specifier));
	assertUnique(result.map(item => item.specifier), path, 'interop specifier');
	return result;
}

function summarizeCoverage(roots: readonly SemanticRootSnapshotV1[]): SemanticCoverageSummaryV1 {
	let modeled = 0;
	let partial = 0;
	let opaque = 0;
	let unknown = 0;
	for (const root of roots) {
		switch (root.coverage) {
			case 'modeled': modeled += 1; break;
			case 'partial': partial += 1; break;
			case 'opaque': opaque += 1; break;
			case 'unknown': unknown += 1; break;
		}
	}
	return {
		enumeratedRoots: roots.length,
		modeled,
		partial,
		opaque,
		unknown,
		allEnumeratedRootsModeled: partial === 0 && opaque === 0 && unknown === 0,
	};
}

function canonicalTextSet(values: readonly string[], path: string): readonly string[] {
	if (!Array.isArray(values)) throw new SemanticSnapshotError(path, 'expected an array');
	const result = values.map((value, index) => nonEmptyText(value, `${path}[${index}]`)).sort(compareText);
	assertUnique(result, path, 'value');
	return result;
}

function normalizedSourcePath(value: string, path: string): string {
	const text = nonEmptyText(value, path).replaceAll('\\', '/');
	if (text.startsWith('/') || /^[A-Za-z]:\//u.test(text)) throw new SemanticSnapshotError(path, 'absolute paths are not allowed');
	const parts: string[] = [];
	for (const segment of text.split('/')) {
		if (segment.length === 0 || segment === '.') continue;
		if (segment === '..') {
			if (parts.length === 0) throw new SemanticSnapshotError(path, 'path escapes the source root');
			parts.pop();
			continue;
		}
		parts.push(segment);
	}
	if (parts.length === 0) throw new SemanticSnapshotError(path, 'path must identify a source');
	return parts.join('/');
}

function nullableSha256(value: string | null, path: string): string | null {
	return value === null ? null : sha256(value, path);
}

function sha256(value: string, path: string): string {
	const text = nonEmptyText(value, path).toLowerCase();
	if (!SHA256_PATTERN.test(text)) throw new SemanticSnapshotError(path, 'expected a SHA-256 hex digest');
	return text;
}

function nonEmptyText(value: string, path: string): string {
	if (typeof value !== 'string') throw new SemanticSnapshotError(path, 'expected a string');
	if (value.length === 0) throw new SemanticSnapshotError(path, 'string must not be empty');
	if (value.includes('\u0000')) throw new SemanticSnapshotError(path, 'NUL is not allowed');
	return value;
}

function nonNegativeInteger(value: number, path: string): number {
	if (!Number.isSafeInteger(value) || value < 0) throw new SemanticSnapshotError(path, 'expected a non-negative safe integer');
	return value;
}

function oneOf<const T extends readonly string[]>(value: string, allowed: T, path: string): T[number] {
	if (typeof value !== 'string' || !allowed.includes(value)) {
		throw new SemanticSnapshotError(path, `expected one of ${allowed.join(', ')}`);
	}
	return value as T[number];
}

function assertUnique(values: readonly string[], path: string, name: string): void {
	for (let index = 1; index < values.length; index += 1) {
		if (values[index] === values[index - 1]) throw new SemanticSnapshotError(path, `duplicate ${name} ${values[index]}`);
	}
}

function numericKey(value: number): string {
	return String(value).padStart(16, '0');
}

function compareTuple(left: readonly string[], right: readonly string[]): number {
	for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
		const comparison = compareText(left[index] ?? '', right[index] ?? '');
		if (comparison !== 0) return comparison;
	}
	return 0;
}

function compareText(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}
