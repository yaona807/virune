import { createHash } from 'node:crypto';
import {
	KERNEL_CONTRACT_VERSION,
	KERNEL_LANGUAGE_VERSION,
	normalizeKernelPath,
	validateKernelInput,
	type KernelInputV1,
	type KernelPlatform,
} from './contract.js';

export const KERNEL_SOURCE_MANIFEST_VERSION = '1' as const;

export interface KernelSourceManifestEntryV1 {
	readonly path: string;
	readonly sourceSha256: string;
	readonly utf8ByteLength: number;
	readonly lineCount: number;
}

export interface KernelSourceManifestV1 {
	readonly version: typeof KERNEL_SOURCE_MANIFEST_VERSION;
	readonly contractVersion: typeof KERNEL_CONTRACT_VERSION;
	readonly languageVersion: typeof KERNEL_LANGUAGE_VERSION;
	readonly platform: KernelPlatform;
	readonly entryPath: string;
	readonly sources: readonly KernelSourceManifestEntryV1[];
}

export interface KernelSourceManifestResultV1 {
	readonly manifest: KernelSourceManifestV1;
	readonly serialized: string;
	readonly sha256: string;
}

export class KernelSourceManifestError extends Error {
	public override readonly name = 'KernelSourceManifestError';
	public constructor(public readonly path: string, message: string) {
		super(`${path}: ${message}`);
	}
}

const sha256Pattern = /^[0-9a-f]{64}$/u;

export function createKernelSourceManifest(value: unknown): KernelSourceManifestResultV1 {
	const input = validateKernelInput(value);
	const sources = input.sources.map(source => sourceManifestEntry(source.path, source.text)).sort(compareSourcePath);
	return resultFor({
		version: KERNEL_SOURCE_MANIFEST_VERSION,
		contractVersion: KERNEL_CONTRACT_VERSION,
		languageVersion: KERNEL_LANGUAGE_VERSION,
		platform: input.platform,
		entryPath: input.entryPath,
		sources,
	});
}

export function validateKernelSourceManifest(value: unknown): KernelSourceManifestResultV1 {
	const manifestValue = record(value, '$');
	exactKeys(manifestValue, ['version', 'contractVersion', 'languageVersion', 'platform', 'entryPath', 'sources'], '$');
	literal(manifestValue.version, KERNEL_SOURCE_MANIFEST_VERSION, '$.version');
	literal(manifestValue.contractVersion, KERNEL_CONTRACT_VERSION, '$.contractVersion');
	literal(manifestValue.languageVersion, KERNEL_LANGUAGE_VERSION, '$.languageVersion');
	const platform = oneOf(manifestValue.platform, ['node', 'browser', 'neutral'] as const, '$.platform');
	const entryPath = canonicalPath(manifestValue.entryPath, '$.entryPath');
	const sourceValues = array(manifestValue.sources, '$.sources');
	if (sourceValues.length === 0) throw new KernelSourceManifestError('$.sources', 'at least one source entry is required');
	const sources = sourceValues.map((source, index) => validateSourceEntry(source, `$.sources[${index}]`));
	for (let index = 1; index < sources.length; index += 1) {
		const previous = sources[index - 1]!;
		const current = sources[index]!;
		if (previous.path >= current.path) {
			throw new KernelSourceManifestError(`$.sources[${index}].path`, 'source entries must be strictly ordered by canonical path');
		}
	}
	if (!sources.some(source => source.path === entryPath)) {
		throw new KernelSourceManifestError('$.entryPath', 'entryPath must match one source entry');
	}
	return resultFor({
		version: KERNEL_SOURCE_MANIFEST_VERSION,
		contractVersion: KERNEL_CONTRACT_VERSION,
		languageVersion: KERNEL_LANGUAGE_VERSION,
		platform,
		entryPath,
		sources,
	});
}

export function verifyKernelSourceManifest(
	value: unknown,
	inputValue: unknown,
	expectedSha256?: string,
): KernelSourceManifestResultV1 {
	const actual = validateKernelSourceManifest(value);
	if (expectedSha256 !== undefined) {
		const normalizedExpectedSha256 = normalizedSha256(expectedSha256, '$expectedSha256');
		if (actual.sha256 !== normalizedExpectedSha256) {
			throw new KernelSourceManifestError('$expectedSha256', `expected ${normalizedExpectedSha256}, received ${actual.sha256}`);
		}
	}
	const expected = createKernelSourceManifest(inputValue);
	assertManifestMatches(actual.manifest, expected.manifest);
	return actual;
}

function sourceManifestEntry(path: string, sourceText: string): KernelSourceManifestEntryV1 {
	const text = normalizeLineEndings(sourceText);
	return {
		path,
		sourceSha256: createHash('sha256').update(text, 'utf8').digest('hex'),
		utf8ByteLength: Buffer.byteLength(text, 'utf8'),
		lineCount: countLines(text),
	};
}

function validateSourceEntry(value: unknown, path: string): KernelSourceManifestEntryV1 {
	const source = record(value, path);
	exactKeys(source, ['path', 'sourceSha256', 'utf8ByteLength', 'lineCount'], path);
	return {
		path: canonicalPath(source.path, `${path}.path`),
		sourceSha256: normalizedSha256(source.sourceSha256, `${path}.sourceSha256`),
		utf8ByteLength: nonNegativeSafeInteger(source.utf8ByteLength, `${path}.utf8ByteLength`),
		lineCount: positiveSafeInteger(source.lineCount, `${path}.lineCount`),
	};
}

function resultFor(manifest: KernelSourceManifestV1): KernelSourceManifestResultV1 {
	const serialized = JSON.stringify(manifest);
	return {
		manifest,
		serialized,
		sha256: createHash('sha256').update(serialized, 'utf8').digest('hex'),
	};
}

function assertManifestMatches(actual: KernelSourceManifestV1, expected: KernelSourceManifestV1): void {
	for (const field of ['version', 'contractVersion', 'languageVersion', 'platform', 'entryPath'] as const) {
		if (actual[field] !== expected[field]) {
			throw new KernelSourceManifestError(`$.${field}`, `expected ${JSON.stringify(expected[field])}, received ${JSON.stringify(actual[field])}`);
		}
	}
	if (actual.sources.length !== expected.sources.length) {
		throw new KernelSourceManifestError('$.sources', `expected ${expected.sources.length} entries, received ${actual.sources.length}`);
	}
	for (let index = 0; index < expected.sources.length; index += 1) {
		const actualSource = actual.sources[index]!;
		const expectedSource = expected.sources[index]!;
		for (const field of ['path', 'sourceSha256', 'utf8ByteLength', 'lineCount'] as const) {
			if (actualSource[field] !== expectedSource[field]) {
				throw new KernelSourceManifestError(
					`$.sources[${index}].${field}`,
					`expected ${JSON.stringify(expectedSource[field])}, received ${JSON.stringify(actualSource[field])}`,
				);
			}
		}
	}
}

function canonicalPath(value: unknown, path: string): string {
	const input = string(value, path);
	const normalized = normalizeKernelPath(input, path);
	if (input !== normalized) throw new KernelSourceManifestError(path, `path must be canonical (${normalized})`);
	return normalized;
}

function normalizeLineEndings(value: string): string {
	return value.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
}

function countLines(value: string): number {
	let count = 1;
	for (const character of value) if (character === '\n') count += 1;
	return count;
}

function normalizedSha256(value: unknown, path: string): string {
	const hash = string(value, path);
	if (!sha256Pattern.test(hash)) throw new KernelSourceManifestError(path, 'expected a lowercase SHA-256 value');
	return hash;
}

function record(value: unknown, path: string): Record<string, unknown> {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		throw new KernelSourceManifestError(path, 'expected an object');
	}
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) {
		throw new KernelSourceManifestError(path, 'expected a plain data object');
	}
	return value as Record<string, unknown>;
}

function array(value: unknown, path: string): readonly unknown[] {
	if (!Array.isArray(value)) throw new KernelSourceManifestError(path, 'expected an array');
	return value;
}

function string(value: unknown, path: string): string {
	if (typeof value !== 'string') throw new KernelSourceManifestError(path, 'expected a string');
	return value;
}

function nonNegativeSafeInteger(value: unknown, path: string): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
		throw new KernelSourceManifestError(path, 'expected a non-negative safe integer');
	}
	return value;
}

function positiveSafeInteger(value: unknown, path: string): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
		throw new KernelSourceManifestError(path, 'expected a positive safe integer');
	}
	return value;
}

function literal<T extends string>(value: unknown, expected: T, path: string): T {
	if (value !== expected) throw new KernelSourceManifestError(path, `expected ${JSON.stringify(expected)}`);
	return expected;
}

function oneOf<const T extends readonly string[]>(value: unknown, allowed: T, path: string): T[number] {
	if (typeof value !== 'string' || !allowed.includes(value)) {
		throw new KernelSourceManifestError(path, `expected one of ${allowed.join(', ')}`);
	}
	return value as T[number];
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], path: string): void {
	const allowedSet = new Set(allowed);
	for (const key of Object.keys(value)) {
		if (!allowedSet.has(key)) throw new KernelSourceManifestError(`${path}.${key}`, 'unknown property');
	}
	for (const key of allowed) {
		if (!Object.hasOwn(value, key)) throw new KernelSourceManifestError(`${path}.${key}`, 'missing property');
	}
}

function compareSourcePath(left: KernelSourceManifestEntryV1, right: KernelSourceManifestEntryV1): number {
	return left.path < right.path ? -1 : left.path > right.path ? 1 : 0;
}

export type { KernelInputV1 };
