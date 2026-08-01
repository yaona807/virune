import {
	KERNEL_CONTRACT_VERSION,
	normalizeKernelPath,
	type KernelPlatform,
} from './contract.js';

export const INTEROP_RESOLUTION_WITNESS_VERSION = 1 as const;

export type InteropResolutionKind = 'builtin' | 'package' | 'relative' | 'url';
export type InteropRuntimeFormat = 'commonjs' | 'esm' | 'global' | 'side-effect';

export interface InteropResolutionWitnessModuleV1 {
	readonly specifier: string;
	readonly resolutionKind: InteropResolutionKind;
	readonly resolvedId: string;
	readonly runtimeFormat: InteropRuntimeFormat;
	readonly artifactSha256: string | null;
	readonly typeSnapshotSha256: string;
}

export interface InteropResolutionWitnessV1 {
	readonly version: typeof INTEROP_RESOLUTION_WITNESS_VERSION;
	readonly contractVersion: typeof KERNEL_CONTRACT_VERSION;
	readonly platform: KernelPlatform;
	readonly candidateSha: string;
	readonly sourceManifestSha256: string;
	readonly modules: readonly InteropResolutionWitnessModuleV1[];
}

export interface InteropResolutionExpectation {
	readonly contractVersion: typeof KERNEL_CONTRACT_VERSION;
	readonly platform: KernelPlatform;
	readonly candidateSha: string;
	readonly sourceManifestSha256: string;
	readonly specifiers: readonly string[];
}

export class InteropResolutionWitnessError extends Error {
	public override readonly name = 'InteropResolutionWitnessError';
	public constructor(public readonly path: string, message: string) {
		super(`${path}: ${message}`);
	}
}

const sha256Pattern = /^[0-9a-f]{64}$/u;
const commitShaPattern = /^[0-9a-f]{40}$/u;

export function validateInteropResolutionWitness(
	value: unknown,
	expectation: InteropResolutionExpectation,
): InteropResolutionWitnessV1 {
	validateExpectation(expectation);
	const witness = record(value, '$');
	exactKeys(witness, ['version', 'contractVersion', 'platform', 'candidateSha', 'sourceManifestSha256', 'modules'], '$');
	if (witness.version !== INTEROP_RESOLUTION_WITNESS_VERSION) {
		throw new InteropResolutionWitnessError('$.version', `expected ${INTEROP_RESOLUTION_WITNESS_VERSION}`);
	}
	const contractVersion = literal(witness.contractVersion, KERNEL_CONTRACT_VERSION, '$.contractVersion');
	const platform = oneOf(witness.platform, ['node', 'browser', 'neutral'] as const, '$.platform');
	const candidateSha = commitSha(witness.candidateSha, '$.candidateSha');
	const sourceManifestSha256 = sha256(witness.sourceManifestSha256, '$.sourceManifestSha256');
	assertEqual(contractVersion, expectation.contractVersion, '$.contractVersion', 'stale contract version');
	assertEqual(platform, expectation.platform, '$.platform', 'stale platform');
	assertEqual(candidateSha, expectation.candidateSha.toLowerCase(), '$.candidateSha', 'stale candidate SHA');
	assertEqual(sourceManifestSha256, expectation.sourceManifestSha256.toLowerCase(), '$.sourceManifestSha256', 'stale source manifest');

	const modules = array(witness.modules, '$.modules')
		.map((module, index) => validateModule(module, `$.modules[${index}]`))
		.sort((left, right) => compareText(left.specifier, right.specifier));
	assertUnique(modules.map(module => module.specifier), '$.modules', 'specifier');
	const actualSpecifiers = modules.map(module => module.specifier);
	const expectedSpecifiers = canonicalSpecifiers(expectation.specifiers, '$expectation.specifiers');
	const missing = expectedSpecifiers.filter(specifier => !actualSpecifiers.includes(specifier));
	const unexpected = actualSpecifiers.filter(specifier => !expectedSpecifiers.includes(specifier));
	if (missing.length > 0) throw new InteropResolutionWitnessError('$.modules', `missing specifiers: ${missing.join(', ')}`);
	if (unexpected.length > 0) throw new InteropResolutionWitnessError('$.modules', `unexpected specifiers: ${unexpected.join(', ')}`);

	return {
		version: INTEROP_RESOLUTION_WITNESS_VERSION,
		contractVersion,
		platform,
		candidateSha,
		sourceManifestSha256,
		modules,
	};
}

export function serializeInteropResolutionWitness(witness: InteropResolutionWitnessV1): string {
	return JSON.stringify(witness);
}

function validateExpectation(expectation: InteropResolutionExpectation): void {
	if (expectation.contractVersion !== KERNEL_CONTRACT_VERSION) {
		throw new InteropResolutionWitnessError('$expectation.contractVersion', `expected ${KERNEL_CONTRACT_VERSION}`);
	}
	oneOf(expectation.platform, ['node', 'browser', 'neutral'] as const, '$expectation.platform');
	commitSha(expectation.candidateSha, '$expectation.candidateSha');
	sha256(expectation.sourceManifestSha256, '$expectation.sourceManifestSha256');
	canonicalSpecifiers(expectation.specifiers, '$expectation.specifiers');
}

function validateModule(value: unknown, path: string): InteropResolutionWitnessModuleV1 {
	const module = record(value, path);
	exactKeys(module, ['specifier', 'resolutionKind', 'resolvedId', 'runtimeFormat', 'artifactSha256', 'typeSnapshotSha256'], path);
	const specifier = nonEmptyString(module.specifier, `${path}.specifier`);
	const resolutionKind = oneOf(module.resolutionKind, ['builtin', 'package', 'relative', 'url'] as const, `${path}.resolutionKind`);
	const runtimeFormat = oneOf(module.runtimeFormat, ['commonjs', 'esm', 'global', 'side-effect'] as const, `${path}.runtimeFormat`);
	const resolvedId = normalizeResolvedId(module.resolvedId, resolutionKind, `${path}.resolvedId`);
	const artifactSha256 = module.artifactSha256 === null
		? null
		: sha256(module.artifactSha256, `${path}.artifactSha256`);
	if (resolutionKind === 'builtin' && artifactSha256 !== null) {
		throw new InteropResolutionWitnessError(`${path}.artifactSha256`, 'builtin modules must use null artifactSha256');
	}
	if (resolutionKind !== 'builtin' && artifactSha256 === null) {
		throw new InteropResolutionWitnessError(`${path}.artifactSha256`, 'non-builtin modules require an artifactSha256');
	}
	return {
		specifier,
		resolutionKind,
		resolvedId,
		runtimeFormat,
		artifactSha256,
		typeSnapshotSha256: sha256(module.typeSnapshotSha256, `${path}.typeSnapshotSha256`),
	};
}

function normalizeResolvedId(value: unknown, kind: InteropResolutionKind, path: string): string {
	const resolvedId = nonEmptyString(value, path);
	if (kind === 'builtin') {
		if (!resolvedId.startsWith('node:') || resolvedId.length === 'node:'.length) {
			throw new InteropResolutionWitnessError(path, 'builtin resolvedId must use a non-empty node: specifier');
		}
		return resolvedId;
	}
	if (kind === 'relative') {
		try {
			return normalizeKernelPath(resolvedId, path);
		} catch (error) {
			throw new InteropResolutionWitnessError(path, error instanceof Error ? error.message.replace(/^.*?: /u, '') : 'invalid path');
		}
	}
	if (kind === 'url') {
		let url: URL;
		try {
			url = new URL(resolvedId);
		} catch {
			throw new InteropResolutionWitnessError(path, 'expected an absolute HTTPS URL');
		}
		if (url.protocol !== 'https:' || url.username.length > 0 || url.password.length > 0 || url.hash.length > 0) {
			throw new InteropResolutionWitnessError(path, 'URL resolutions must be credential-free HTTPS URLs without fragments');
		}
		return url.toString();
	}
	return resolvedId;
}

function canonicalSpecifiers(value: readonly string[], path: string): readonly string[] {
	if (!Array.isArray(value)) throw new InteropResolutionWitnessError(path, 'expected an array');
	const specifiers = value.map((specifier, index) => nonEmptyString(specifier, `${path}[${index}]`)).sort(compareText);
	assertUnique(specifiers, path, 'specifier');
	return specifiers;
}

function record(value: unknown, path: string): Record<string, unknown> {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new InteropResolutionWitnessError(path, 'expected an object');
	return value as Record<string, unknown>;
}

function array(value: unknown, path: string): readonly unknown[] {
	if (!Array.isArray(value)) throw new InteropResolutionWitnessError(path, 'expected an array');
	return value;
}

function nonEmptyString(value: unknown, path: string): string {
	if (typeof value !== 'string') throw new InteropResolutionWitnessError(path, 'expected a string');
	if (value.length === 0) throw new InteropResolutionWitnessError(path, 'string must not be empty');
	return value;
}

function literal<T extends string>(value: unknown, expected: T, path: string): T {
	if (value !== expected) throw new InteropResolutionWitnessError(path, `expected ${JSON.stringify(expected)}`);
	return expected;
}

function oneOf<const T extends readonly string[]>(value: unknown, allowed: T, path: string): T[number] {
	if (typeof value !== 'string' || !allowed.includes(value)) {
		throw new InteropResolutionWitnessError(path, `expected one of ${allowed.join(', ')}`);
	}
	return value as T[number];
}

function sha256(value: unknown, path: string): string {
	const hash = nonEmptyString(value, path).toLowerCase();
	if (!sha256Pattern.test(hash)) throw new InteropResolutionWitnessError(path, 'expected a SHA-256 hex digest');
	return hash;
}

function commitSha(value: unknown, path: string): string {
	const hash = nonEmptyString(value, path).toLowerCase();
	if (!commitShaPattern.test(hash)) throw new InteropResolutionWitnessError(path, 'expected a full 40-character commit SHA');
	return hash;
}

function assertEqual(actual: string, expected: string, path: string, message: string): void {
	if (actual !== expected) throw new InteropResolutionWitnessError(path, message);
}

function assertUnique(values: readonly string[], path: string, name: string): void {
	for (let index = 1; index < values.length; index += 1) {
		if (values[index] === values[index - 1]) throw new InteropResolutionWitnessError(path, `duplicate ${name} ${values[index]}`);
	}
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], path: string): void {
	const allowedSet = new Set(allowed);
	for (const key of Object.keys(value)) if (!allowedSet.has(key)) throw new InteropResolutionWitnessError(`${path}.${key}`, 'unknown property');
	for (const key of allowed) if (!Object.hasOwn(value, key)) throw new InteropResolutionWitnessError(`${path}.${key}`, 'missing property');
}

function compareText(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}
