import { createHash } from 'node:crypto';
import { posix } from 'node:path';

export const BOOTSTRAP_ARTIFACT_POLICY_VERSION = 1 as const;

export type JsonValue =
	| null
	| boolean
	| number
	| string
	| readonly JsonValue[]
	| JsonObject;

type JsonObject = { readonly [key: string]: JsonValue };

export interface BootstrapArtifactModuleInput {
	readonly path: string;
	readonly code: string;
	readonly sourceMap: JsonValue;
	readonly exports: readonly string[];
}

export interface BootstrapChecksumInput {
	readonly path: string;
	readonly sha256: string;
}

export interface BootstrapArtifactInput {
	readonly policyVersion: number;
	readonly root: string;
	readonly modules: readonly BootstrapArtifactModuleInput[];
	readonly diagnosticsSchema: JsonValue;
	readonly metadata: Readonly<Record<string, JsonValue>>;
	readonly checksumManifest: readonly BootstrapChecksumInput[];
}

export interface NormalizedBootstrapArtifactModule {
	readonly path: string;
	readonly code: string;
	readonly sourceMap: JsonValue;
	readonly exports: readonly string[];
}

export interface NormalizedBootstrapChecksum {
	readonly path: string;
	readonly sha256: string;
}

export interface NormalizedBootstrapArtifact {
	readonly policy: {
		readonly version: typeof BOOTSTRAP_ARTIFACT_POLICY_VERSION;
		readonly ignoredMetadataFields: readonly string[];
	};
	readonly moduleOrder: readonly string[];
	readonly modules: readonly NormalizedBootstrapArtifactModule[];
	readonly diagnosticsSchema: JsonValue;
	readonly metadata: Readonly<Record<string, JsonValue>>;
	readonly checksumManifest: readonly NormalizedBootstrapChecksum[];
}

export interface NormalizedBootstrapArtifactResult {
	readonly artifact: NormalizedBootstrapArtifact;
	readonly serialized: string;
	readonly sha256: string;
}

export interface BootstrapArtifactDiffEntry {
	readonly section: string;
	readonly path: string;
	readonly before: string;
	readonly after: string;
}

export interface BootstrapArtifactDiff {
	readonly equal: boolean;
	readonly beforeSha256: string;
	readonly afterSha256: string;
	readonly changes: readonly BootstrapArtifactDiffEntry[];
}

const IGNORED_METADATA_FIELDS = ['generatedAt', 'runId'] as const;
const ignoredMetadataFieldSet = new Set<string>(IGNORED_METADATA_FIELDS);
const sha256Pattern = /^[0-9a-f]{64}$/u;

export function normalizeBootstrapArtifact(input: BootstrapArtifactInput): NormalizedBootstrapArtifactResult {
	if (input.policyVersion !== BOOTSTRAP_ARTIFACT_POLICY_VERSION) {
		throw new Error(`Unsupported bootstrap artifact policy version: ${input.policyVersion}`);
	}

	const root = normalizeRoot(input.root);
	const modules = input.modules.map(module => normalizeModule(module, root)).sort(comparePath);
	assertUniquePaths(modules.map(module => module.path), 'module');

	const checksumManifest = input.checksumManifest
		.map(entry => normalizeChecksum(entry, root))
		.sort(comparePath);
	assertUniquePaths(checksumManifest.map(entry => entry.path), 'checksum');

	const artifact: NormalizedBootstrapArtifact = {
		policy: {
			version: BOOTSTRAP_ARTIFACT_POLICY_VERSION,
			ignoredMetadataFields: [...IGNORED_METADATA_FIELDS],
		},
		moduleOrder: modules.map(module => module.path),
		modules,
		diagnosticsSchema: canonicalizeJson(input.diagnosticsSchema),
		metadata: normalizeMetadata(input.metadata),
		checksumManifest,
	};
	const serialized = JSON.stringify(artifact);
	return {
		artifact,
		serialized,
		sha256: createHash('sha256').update(serialized).digest('hex'),
	};
}

export function diffBootstrapArtifacts(
	before: NormalizedBootstrapArtifactResult,
	after: NormalizedBootstrapArtifactResult,
): BootstrapArtifactDiff {
	const changes: BootstrapArtifactDiffEntry[] = [];
	const beforeValue = JSON.parse(before.serialized) as JsonValue;
	const afterValue = JSON.parse(after.serialized) as JsonValue;
	collectDiff(beforeValue, afterValue, '', changes);
	return {
		equal: changes.length === 0,
		beforeSha256: before.sha256,
		afterSha256: after.sha256,
		changes,
	};
}

function normalizeModule(
	module: BootstrapArtifactModuleInput,
	root: string,
): NormalizedBootstrapArtifactModule {
	const path = canonicalizeArtifactPath(module.path, root);
	const exports = [...module.exports].sort(compareText);
	assertUniqueValues(exports, `exports for ${path}`);
	return {
		path,
		code: normalizeLineEndings(module.code),
		sourceMap: canonicalizeSourceMap(module.sourceMap, root),
		exports,
	};
}

function normalizeChecksum(entry: BootstrapChecksumInput, root: string): NormalizedBootstrapChecksum {
	const sha256 = entry.sha256.toLowerCase();
	if (!sha256Pattern.test(sha256)) {
		throw new Error(`Invalid SHA-256 for ${entry.path}`);
	}
	return {
		path: canonicalizeArtifactPath(entry.path, root),
		sha256,
	};
}

function normalizeMetadata(metadata: Readonly<Record<string, JsonValue>>): Readonly<Record<string, JsonValue>> {
	const normalized: Record<string, JsonValue> = {};
	for (const key of Object.keys(metadata).sort(compareText)) {
		if (ignoredMetadataFieldSet.has(key)) continue;
		const value = metadata[key];
		if (value === undefined) throw new Error(`Metadata field ${key} is undefined`);
		normalized[key] = canonicalizeJson(value);
	}
	return normalized;
}

function canonicalizeSourceMap(value: JsonValue, root: string, path: readonly string[] = []): JsonValue {
	if (value === null || typeof value === 'boolean' || typeof value === 'number') {
		return canonicalizeJson(value);
	}
	if (typeof value === 'string') {
		const key = path.at(-1);
		const parent = path.at(-2);
		if (key === 'file' || parent === 'sources') return canonicalizeArtifactPath(value, root);
		if (key === 'sourceRoot') return value.length === 0 ? '' : canonicalizeArtifactPath(value, root);
		return value;
	}
	if (Array.isArray(value)) {
		return value.map((entry, index) => canonicalizeSourceMap(entry, root, [...path, String(index)]));
	}
	const objectValue = value as JsonObject;
	const normalized: Record<string, JsonValue> = {};
	for (const key of Object.keys(objectValue).sort(compareText)) {
		const entry = objectValue[key];
		if (entry === undefined) throw new Error(`Source map field ${[...path, key].join('.')} is undefined`);
		normalized[key] = canonicalizeSourceMap(entry, root, [...path, key]);
	}
	return normalized;
}

function canonicalizeJson(value: JsonValue, path: readonly string[] = []): JsonValue {
	if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
	if (typeof value === 'number') {
		if (!Number.isFinite(value)) throw new Error(`Non-finite JSON number at ${path.join('.') || '<root>'}`);
		return value;
	}
	if (Array.isArray(value)) {
		return value.map((entry, index) => canonicalizeJson(entry, [...path, String(index)]));
	}
	const objectValue = value as JsonObject;
	const normalized: Record<string, JsonValue> = {};
	for (const key of Object.keys(objectValue).sort(compareText)) {
		const entry = objectValue[key];
		if (entry === undefined) throw new Error(`JSON field ${[...path, key].join('.')} is undefined`);
		normalized[key] = canonicalizeJson(entry, [...path, key]);
	}
	return normalized;
}

function canonicalizeArtifactPath(value: string, root: string): string {
	let candidate = normalizeSlashes(value);
	if (candidate.startsWith('file://')) candidate = candidate.slice('file://'.length);
	if (root.length > 0) {
		if (candidate === root) candidate = '.';
		else if (candidate.startsWith(`${root}/`)) candidate = candidate.slice(root.length + 1);
	}
	while (candidate.startsWith('./')) candidate = candidate.slice(2);
	candidate = posix.normalize(candidate);
	if (candidate.length === 0 || candidate === '.') throw new Error(`Artifact path must reference a file: ${value}`);
	if (candidate === '..' || candidate.startsWith('../') || candidate.startsWith('/') || /^[A-Za-z]:\//u.test(candidate)) {
		throw new Error(`Artifact path escapes the configured root: ${value}`);
	}
	return candidate;
}

function normalizeRoot(value: string): string {
	let root = normalizeSlashes(value);
	if (root.startsWith('file://')) root = root.slice('file://'.length);
	while (root.length > 1 && root.endsWith('/')) root = root.slice(0, -1);
	return root;
}

function normalizeSlashes(value: string): string {
	return value.replaceAll('\\', '/');
}

function normalizeLineEndings(value: string): string {
	return value.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
}

function assertUniquePaths(paths: readonly string[], kind: string): void {
	assertUniqueValues(paths, `${kind} paths`);
}

function assertUniqueValues(values: readonly string[], kind: string): void {
	for (let index = 1; index < values.length; index += 1) {
		if (values[index] === values[index - 1]) throw new Error(`Duplicate ${kind}: ${values[index]}`);
	}
}

function comparePath<T extends { readonly path: string }>(left: T, right: T): number {
	return compareText(left.path, right.path);
}

function compareText(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

function collectDiff(
	before: JsonValue | undefined,
	after: JsonValue | undefined,
	path: string,
	changes: BootstrapArtifactDiffEntry[],
): void {
	if (before === undefined || after === undefined) {
		pushDiff(path, before, after, changes);
		return;
	}
	if (isPrimitive(before) || isPrimitive(after)) {
		if (!Object.is(before, after)) pushDiff(path, before, after, changes);
		return;
	}
	if (Array.isArray(before) || Array.isArray(after)) {
		if (!Array.isArray(before) || !Array.isArray(after)) {
			pushDiff(path, before, after, changes);
			return;
		}
		const length = Math.max(before.length, after.length);
		for (let index = 0; index < length; index += 1) {
			collectDiff(before[index], after[index], `${path}[${index}]`, changes);
		}
		return;
	}
	const beforeObject = before as JsonObject;
	const afterObject = after as JsonObject;
	const keys = [...new Set([...Object.keys(beforeObject), ...Object.keys(afterObject)])].sort(compareText);
	for (const key of keys) {
		const childPath = path.length === 0 ? key : `${path}.${key}`;
		collectDiff(beforeObject[key], afterObject[key], childPath, changes);
	}
}

function isPrimitive(value: JsonValue): value is null | boolean | number | string {
	return value === null || typeof value !== 'object';
}

function pushDiff(
	path: string,
	before: JsonValue | undefined,
	after: JsonValue | undefined,
	changes: BootstrapArtifactDiffEntry[],
): void {
	changes.push({
		section: sectionOf(path),
		path: path.length === 0 ? '<root>' : path,
		before: before === undefined ? '<missing>' : JSON.stringify(before),
		after: after === undefined ? '<missing>' : JSON.stringify(after),
	});
}

function sectionOf(path: string): string {
	if (path.length === 0) return '<root>';
	const dot = path.indexOf('.');
	const bracket = path.indexOf('[');
	const boundaryCandidates = [dot, bracket].filter(value => value >= 0);
	const boundary = boundaryCandidates.length === 0 ? path.length : Math.min(...boundaryCandidates);
	return path.slice(0, boundary);
}
