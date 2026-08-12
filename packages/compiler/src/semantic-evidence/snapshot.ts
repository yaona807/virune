export const EXPERIMENTAL_SEMANTIC_SNAPSHOT_VERSION = 1 as const;

export type SemanticEvidencePlatform = 'node' | 'browser' | 'neutral';
export type SemanticCoverageStatus = 'modeled' | 'partial' | 'opaque' | 'unknown';
export type SemanticReachability = 'yes' | 'no' | 'unknown';
export type SemanticInteropTier = 'direct' | 'adapter' | 'host' | 'unsafe' | 'unknown';
export type SemanticRootScopeStatus = 'project-wide' | 'partial';

export interface SemanticInputClosureV1 {
	readonly languageVersion: string;
	readonly platform: SemanticEvidencePlatform;
	readonly profile: string;
	readonly analyzerSha256: string;
	readonly sourceManifestSha256: string;
	readonly projectManifestSha256: string;
	readonly stdlibSha256: string;
	readonly runtimeSha256: string;
	readonly dependencyArtifactsSha256: string;
	readonly interopManifestSha256: string | null;
	readonly configurationSha256: string | null;
}

export interface SemanticRootScopeV1 {
	readonly status: SemanticRootScopeStatus;
	readonly includedRootClasses: readonly string[];
	readonly excludedRootClasses: readonly string[];
}

export interface SemanticSourceEvidenceV1 {
	readonly sourcePath: string;
	readonly startOffset: number;
	readonly endOffset: number;
}

export interface SemanticDimensionStateV1 {
	readonly coverage: SemanticCoverageStatus;
	readonly reasons: readonly string[];
	readonly assumptions: readonly string[];
	readonly sourceEvidence: readonly SemanticSourceEvidenceV1[];
}

export interface SemanticDimensionStatesV1 {
	readonly publicAbi: SemanticDimensionStateV1;
	readonly effects: SemanticDimensionStateV1;
	readonly interop: SemanticDimensionStateV1;
	readonly reachableFailures: SemanticDimensionStateV1;
	readonly panic: SemanticDimensionStateV1;
	readonly discard: SemanticDimensionStateV1;
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
	readonly dimensions: SemanticDimensionStatesV1;
	readonly implementationSha256: string;
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
	readonly rootScope: SemanticRootScopeV1;
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

export interface SemanticRootSnapshotV1 extends SemanticRootInputV1 {
	readonly coverage: SemanticCoverageStatus;
}

export interface ExperimentalSemanticSnapshotV1 {
	readonly version: typeof EXPERIMENTAL_SEMANTIC_SNAPSHOT_VERSION;
	readonly experimental: true;
	readonly closure: SemanticInputClosureV1;
	readonly rootScope: SemanticRootScopeV1;
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
 * safety meaning to missing facts. Coverage, unresolved reasons, assumptions,
 * and provenance are explicit per semantic dimension; aggregate root coverage
 * is derived conservatively from those dimension states and is never accepted
 * from the caller.
 *
 * Root discovery scope is explicit and separate from per-root coverage: all
 * enumerated roots being modeled does not imply project-wide root discovery.
 * The Semantic Input Closure binds source, project, toolchain/runtime,
 * dependency, Interop, and configuration identities needed by later
 * reproducibility checks.
 *
 * This module is intentionally internal and experimental. It is not a stable
 * Compiler API or artifact-schema compatibility promise.
 */
export function createExperimentalSemanticSnapshot(
	input: SemanticSnapshotInputV1,
): ExperimentalSemanticSnapshotV1 {
	const closure = canonicalClosure(input.closure);
	const rootScope = canonicalRootScope(input.rootScope);
	const roots = input.roots.map((root, index) => canonicalRoot(root, `$.roots[${index}]`));
	roots.sort((left, right) => compareText(left.root, right.root));
	assertUnique(roots.map(root => root.root), '$.roots', 'root');
	assertNoCaseCollidingSourcePaths(roots);
	return {
		version: EXPERIMENTAL_SEMANTIC_SNAPSHOT_VERSION,
		experimental: true,
		closure,
		rootScope,
		coverage: summarizeCoverage(roots),
		roots,
	};
}

export function serializeExperimentalSemanticSnapshot(input: SemanticSnapshotInputV1): string {
	return JSON.stringify(createExperimentalSemanticSnapshot(input));
}

function canonicalClosure(value: SemanticInputClosureV1): SemanticInputClosureV1 {
	return {
		languageVersion: nonEmptyText(value.languageVersion, '$.closure.languageVersion'),
		platform: oneOf(value.platform, ['node', 'browser', 'neutral'] as const, '$.closure.platform'),
		profile: nonEmptyText(value.profile, '$.closure.profile'),
		analyzerSha256: sha256(value.analyzerSha256, '$.closure.analyzerSha256'),
		sourceManifestSha256: sha256(value.sourceManifestSha256, '$.closure.sourceManifestSha256'),
		projectManifestSha256: sha256(value.projectManifestSha256, '$.closure.projectManifestSha256'),
		stdlibSha256: sha256(value.stdlibSha256, '$.closure.stdlibSha256'),
		runtimeSha256: sha256(value.runtimeSha256, '$.closure.runtimeSha256'),
		dependencyArtifactsSha256: sha256(value.dependencyArtifactsSha256, '$.closure.dependencyArtifactsSha256'),
		interopManifestSha256: nullableSha256(value.interopManifestSha256, '$.closure.interopManifestSha256'),
		configurationSha256: nullableSha256(value.configurationSha256, '$.closure.configurationSha256'),
	};
}

function canonicalRootScope(value: SemanticRootScopeV1): SemanticRootScopeV1 {
	const status = oneOf(value.status, ['project-wide', 'partial'] as const, '$.rootScope.status');
	const includedRootClasses = canonicalTextSet(value.includedRootClasses, '$.rootScope.includedRootClasses');
	const excludedRootClasses = canonicalTextSet(value.excludedRootClasses, '$.rootScope.excludedRootClasses');
	if (includedRootClasses.length === 0) {
		throw new SemanticSnapshotError('$.rootScope.includedRootClasses', 'at least one included root class is required');
	}
	const overlap = includedRootClasses.filter(item => excludedRootClasses.includes(item));
	if (overlap.length > 0) {
		throw new SemanticSnapshotError('$.rootScope', `root classes cannot be both included and excluded: ${overlap.join(', ')}`);
	}
	if (status === 'project-wide' && excludedRootClasses.length > 0) {
		throw new SemanticSnapshotError('$.rootScope.excludedRootClasses', 'project-wide scope cannot exclude root classes');
	}
	if (status === 'partial' && excludedRootClasses.length === 0) {
		throw new SemanticSnapshotError('$.rootScope.excludedRootClasses', 'partial scope requires at least one excluded root class');
	}
	return { status, includedRootClasses, excludedRootClasses };
}

function canonicalRoot(value: SemanticRootInputV1, path: string): SemanticRootSnapshotV1 {
	const dimensions = canonicalDimensions(value.dimensions, `${path}.dimensions`);
	const publicAbi = canonicalPublicAbi(value.publicAbi, `${path}.publicAbi`);
	const directEffects = canonicalTextSet(value.directEffects, `${path}.directEffects`);
	const transitiveEffects = canonicalTextSet(value.transitiveEffects, `${path}.transitiveEffects`);
	const interop = canonicalInterop(value.interop, `${path}.interop`);
	const reachableFailures = canonicalTextSet(value.reachableFailures, `${path}.reachableFailures`);
	const panic = oneOf(value.panic, ['yes', 'no', 'unknown'] as const, `${path}.panic`);
	const discard = oneOf(value.discard, ['yes', 'no', 'unknown'] as const, `${path}.discard`);

	if (dimensions.panic.coverage === 'modeled' && panic === 'unknown') {
		throw new SemanticSnapshotError(`${path}.panic`, 'modeled panic dimension cannot contain unknown reachability');
	}
	if (dimensions.discard.coverage === 'modeled' && discard === 'unknown') {
		throw new SemanticSnapshotError(`${path}.discard`, 'modeled discard dimension cannot contain unknown reachability');
	}
	if (dimensions.interop.coverage === 'modeled' && interop.some(item => item.tier === 'unknown')) {
		throw new SemanticSnapshotError(`${path}.interop`, 'modeled interoperability dimension cannot contain an unknown tier');
	}

	return {
		root: nonEmptyText(value.root, `${path}.root`),
		coverage: aggregateDimensionCoverage(dimensions),
		dimensions,
		implementationSha256: sha256(value.implementationSha256, `${path}.implementationSha256`),
		publicAbi,
		directEffects,
		transitiveEffects,
		interop,
		reachableFailures,
		panic,
		discard,
	};
}

function canonicalDimensions(value: SemanticDimensionStatesV1, path: string): SemanticDimensionStatesV1 {
	return {
		publicAbi: canonicalDimensionState(value.publicAbi, `${path}.publicAbi`),
		effects: canonicalDimensionState(value.effects, `${path}.effects`),
		interop: canonicalDimensionState(value.interop, `${path}.interop`),
		reachableFailures: canonicalDimensionState(value.reachableFailures, `${path}.reachableFailures`),
		panic: canonicalDimensionState(value.panic, `${path}.panic`),
		discard: canonicalDimensionState(value.discard, `${path}.discard`),
	};
}

function canonicalDimensionState(value: SemanticDimensionStateV1, path: string): SemanticDimensionStateV1 {
	const coverage = oneOf(value.coverage, ['modeled', 'partial', 'opaque', 'unknown'] as const, `${path}.coverage`);
	const reasons = canonicalTextSet(value.reasons, `${path}.reasons`);
	const assumptions = canonicalTextSet(value.assumptions, `${path}.assumptions`);
	const sourceEvidence = canonicalSourceEvidence(value.sourceEvidence, `${path}.sourceEvidence`);
	if (sourceEvidence.length === 0) {
		throw new SemanticSnapshotError(`${path}.sourceEvidence`, 'at least one source evidence range is required');
	}
	if (coverage === 'modeled' && reasons.length > 0) {
		throw new SemanticSnapshotError(`${path}.reasons`, 'modeled coverage must not carry unresolved reasons');
	}
	if (coverage !== 'modeled' && reasons.length === 0) {
		throw new SemanticSnapshotError(`${path}.reasons`, `${coverage} coverage requires at least one explicit reason`);
	}
	return { coverage, reasons, assumptions, sourceEvidence };
}

function aggregateDimensionCoverage(value: SemanticDimensionStatesV1): SemanticCoverageStatus {
	const states = dimensionStates(value).map(item => item.coverage);
	if (states.includes('unknown')) return 'unknown';
	if (states.includes('opaque')) return 'opaque';
	if (states.includes('partial')) return 'partial';
	return 'modeled';
}

function dimensionStates(value: SemanticDimensionStatesV1): readonly SemanticDimensionStateV1[] {
	return [
		value.publicAbi,
		value.effects,
		value.interop,
		value.reachableFailures,
		value.panic,
		value.discard,
	];
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
		allEnumeratedRootsModeled: roots.length > 0 && partial === 0 && opaque === 0 && unknown === 0,
	};
}

function assertNoCaseCollidingSourcePaths(roots: readonly SemanticRootSnapshotV1[]): void {
	const seen = new Map<string, string>();
	for (const root of roots) {
		for (const dimension of dimensionStates(root.dimensions)) {
			for (const evidence of dimension.sourceEvidence) {
				const sourcePath = evidence.sourcePath.normalize('NFC');
				const folded = sourcePath.toLowerCase();
				const previous = seen.get(folded);
				if (previous !== undefined && previous !== sourcePath) {
					throw new SemanticSnapshotError('$.roots', `case-colliding source paths are not allowed: ${previous}, ${sourcePath}`);
				}
				seen.set(folded, sourcePath);
			}
		}
	}
}

function canonicalTextSet(values: readonly string[], path: string): readonly string[] {
	if (!Array.isArray(values)) throw new SemanticSnapshotError(path, 'expected an array');
	const result = values.map((value, index) => nonEmptyText(value, `${path}[${index}]`)).sort(compareText);
	assertUnique(result, path, 'value');
	return result;
}

function normalizedSourcePath(value: string, path: string): string {
	const text = nonEmptyText(value, path).replaceAll('\\', '/').normalize('NFC');
	if (text.startsWith('/') || /^[A-Za-z]:\//u.test(text)) throw new SemanticSnapshotError(path, 'absolute paths are not allowed');
	const parts: string[] = [];
	for (const segment of text.split('/')) {
		if (segment.length === 0 || segment === '.') continue;
		if (segment === '..') throw new SemanticSnapshotError(path, 'parent path segments are not allowed');
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
	if (value.length === 0 || value.trim().length === 0) {
		throw new SemanticSnapshotError(path, 'string must contain non-whitespace text');
	}
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
	const sorted = [...values].sort(compareText);
	for (let index = 1; index < sorted.length; index += 1) {
		if (sorted[index] === sorted[index - 1]) throw new SemanticSnapshotError(path, `duplicate ${name} ${sorted[index]}`);
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
