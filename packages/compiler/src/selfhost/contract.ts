export const KERNEL_CONTRACT_VERSION = '1' as const;
export const KERNEL_LANGUAGE_VERSION = '1.0' as const;
export const KERNEL_INTEROP_MANIFEST_VERSION = '1' as const;

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | readonly JsonValue[];
export interface JsonObject { readonly [key: string]: JsonValue; }

export type KernelPlatform = 'node' | 'browser' | 'neutral';

export interface KernelSourceV1 {
	readonly path: string;
	readonly text: string;
}

export interface KernelInteropModuleV1 {
	readonly specifier: string;
	readonly metadata: JsonObject;
}

export interface KernelInteropManifestV1 {
	readonly version: typeof KERNEL_INTEROP_MANIFEST_VERSION;
	readonly modules: readonly KernelInteropModuleV1[];
}

export interface KernelEmitOptionsV1 {
	readonly target: 'es2022';
	readonly sourceMap: boolean;
	readonly sourcesContent: boolean;
}

export interface KernelInputV1 {
	readonly contractVersion: typeof KERNEL_CONTRACT_VERSION;
	readonly languageVersion: typeof KERNEL_LANGUAGE_VERSION;
	readonly platform: KernelPlatform;
	readonly entryPath: string;
	readonly sources: readonly KernelSourceV1[];
	readonly interopManifest: KernelInteropManifestV1;
	readonly emit: KernelEmitOptionsV1;
}

export interface KernelPositionV1 {
	readonly offset: number;
	readonly line: number;
	readonly column: number;
}

export interface KernelSpanV1 {
	readonly start: KernelPositionV1;
	readonly end: KernelPositionV1;
}

export interface KernelRelatedDiagnosticV1 {
	readonly message: string;
	readonly sourcePath?: string;
	readonly span: KernelSpanV1;
}

export interface KernelDiagnosticFixV1 {
	readonly id?: string;
	readonly title: string;
	readonly kind: 'insert' | 'replace' | 'remove' | 'rewrite';
	readonly sourcePath?: string;
	readonly span?: KernelSpanV1;
	readonly text?: string;
}

export interface KernelDiagnosticCauseV1 {
	readonly kind: 'unknown' | 'internal';
	readonly message: string;
	readonly name?: string;
	readonly stack?: string;
}

export interface KernelDiagnosticV1 {
	readonly code: string;
	readonly severity: 'error' | 'warning' | 'information' | 'hint';
	readonly message: string;
	readonly sourcePath?: string;
	readonly span: KernelSpanV1;
	readonly related?: readonly KernelRelatedDiagnosticV1[];
	readonly help?: string;
	readonly fixes?: readonly KernelDiagnosticFixV1[];
	readonly cause?: KernelDiagnosticCauseV1;
}

export interface KernelEmittedModuleV1 {
	readonly sourcePath: string;
	readonly outputPath: string;
	readonly code: string;
	readonly sourceMap: string;
}

export interface KernelDependencyV1 {
	readonly modulePath: string;
	readonly sourceKind: 'virune' | 'javascript';
	readonly specifier: string;
	readonly resolvedPath?: string;
	readonly typeOnly: boolean;
	readonly public: boolean;
}

export interface KernelExportedSymbolV1 {
	readonly modulePath: string;
	readonly name: string;
	readonly declarationKind: string;
}

export interface KernelCompilationStatsV1 {
	readonly parsedModules: number;
	readonly reusedParsedModules: number;
	readonly checkedModules: number;
	readonly reusedCheckedModules: number;
	readonly emittedModules: number;
	readonly reusedEmittedModules: number;
	readonly invalidatedModules: number;
}

export interface KernelOutputV1 {
	readonly contractVersion: typeof KERNEL_CONTRACT_VERSION;
	readonly languageVersion: typeof KERNEL_LANGUAGE_VERSION;
	readonly platform: KernelPlatform;
	readonly entryPath: string;
	readonly accepted: boolean;
	readonly diagnostics: readonly KernelDiagnosticV1[];
	readonly emittedModules: readonly KernelEmittedModuleV1[];
	readonly dependencies: readonly KernelDependencyV1[];
	readonly exportedSymbols: readonly KernelExportedSymbolV1[];
	readonly stats: KernelCompilationStatsV1;
}

export class KernelContractError extends Error {
	public override readonly name = 'KernelContractError';
	public constructor(public readonly path: string, message: string) {
		super(`${path}: ${message}`);
	}
}

export function normalizeKernelPath(value: string, path = '$'): string {
	if (value.length === 0) throw new KernelContractError(path, 'path must not be empty');
	if (value.includes('\0')) throw new KernelContractError(path, 'path must not contain NUL');
	const slashPath = value.replaceAll('\\', '/');
	if (slashPath.startsWith('/') || /^[A-Za-z]:\//u.test(slashPath)) throw new KernelContractError(path, 'path must be project-relative');
	const segments: string[] = [];
	for (const segment of slashPath.split('/')) {
		if (segment === '' || segment === '.') continue;
		if (segment === '..') {
			if (segments.length === 0) throw new KernelContractError(path, 'path must not escape the project root');
			segments.pop();
			continue;
		}
		segments.push(segment);
	}
	if (segments.length === 0) throw new KernelContractError(path, 'path must identify a file');
	return segments.join('/');
}

export function validateKernelInput(value: unknown): KernelInputV1 {
	assertJsonData(value, '$');
	const input = record(value, '$');
	exactKeys(input, ['contractVersion', 'languageVersion', 'platform', 'entryPath', 'sources', 'interopManifest', 'emit'], '$');
	literal(input.contractVersion, KERNEL_CONTRACT_VERSION, '$.contractVersion');
	literal(input.languageVersion, KERNEL_LANGUAGE_VERSION, '$.languageVersion');
	const platform = oneOf(input.platform, ['node', 'browser', 'neutral'] as const, '$.platform');
	const entryPath = normalizeKernelPath(string(input.entryPath, '$.entryPath'), '$.entryPath');
	const sources = array(input.sources, '$.sources').map((item, index) => validateSource(item, `$.sources[${index}]`));
	if (sources.length === 0) throw new KernelContractError('$.sources', 'at least one source is required');
	const paths = new Set<string>();
	for (const source of sources) {
		if (paths.has(source.path)) throw new KernelContractError('$.sources', `duplicate source path ${source.path}`);
		paths.add(source.path);
	}
	if (!paths.has(entryPath)) throw new KernelContractError('$.entryPath', 'entryPath must match one source path');
	const interopManifest = validateInteropManifest(input.interopManifest, '$.interopManifest');
	const emit = validateEmit(input.emit, '$.emit');
	return {
		contractVersion: KERNEL_CONTRACT_VERSION,
		languageVersion: KERNEL_LANGUAGE_VERSION,
		platform,
		entryPath,
		sources: [...sources].sort((left, right) => left.path.localeCompare(right.path)),
		interopManifest,
		emit,
	};
}

export function validateKernelOutput(value: unknown): KernelOutputV1 {
	assertJsonData(value, '$');
	const output = record(value, '$');
	exactKeys(output, ['contractVersion', 'languageVersion', 'platform', 'entryPath', 'accepted', 'diagnostics', 'emittedModules', 'dependencies', 'exportedSymbols', 'stats'], '$');
	literal(output.contractVersion, KERNEL_CONTRACT_VERSION, '$.contractVersion');
	literal(output.languageVersion, KERNEL_LANGUAGE_VERSION, '$.languageVersion');
	oneOf(output.platform, ['node', 'browser', 'neutral'] as const, '$.platform');
	normalizeKernelPath(string(output.entryPath, '$.entryPath'), '$.entryPath');
	boolean(output.accepted, '$.accepted');
	array(output.diagnostics, '$.diagnostics');
	array(output.emittedModules, '$.emittedModules');
	array(output.dependencies, '$.dependencies');
	array(output.exportedSymbols, '$.exportedSymbols');
	validateStats(output.stats, '$.stats');
	return cloneJson(output) as unknown as KernelOutputV1;
}

export function roundTripKernelInput(value: KernelInputV1): KernelInputV1 {
	return validateKernelInput(JSON.parse(JSON.stringify(value)) as unknown);
}

export function roundTripKernelOutput(value: KernelOutputV1): KernelOutputV1 {
	return validateKernelOutput(JSON.parse(JSON.stringify(value)) as unknown);
}

function validateSource(value: unknown, path: string): KernelSourceV1 {
	const source = record(value, path);
	exactKeys(source, ['path', 'text'], path);
	return {
		path: normalizeKernelPath(string(source.path, `${path}.path`), `${path}.path`),
		text: string(source.text, `${path}.text`),
	};
}

function validateInteropManifest(value: unknown, path: string): KernelInteropManifestV1 {
	const manifest = record(value, path);
	exactKeys(manifest, ['version', 'modules'], path);
	validateInteropManifestVersion(manifest.version, `${path}.version`);
	const modules = array(manifest.modules, `${path}.modules`).map((item, index) => {
		const module = record(item, `${path}.modules[${index}]`);
		exactKeys(module, ['specifier', 'metadata'], `${path}.modules[${index}]`);
		const metadata = record(module.metadata, `${path}.modules[${index}].metadata`);
		return {
			specifier: nonEmptyString(module.specifier, `${path}.modules[${index}].specifier`),
			metadata: canonicalJsonObject(metadata),
		};
	});
	const specifiers = new Set<string>();
	for (const module of modules) {
		if (specifiers.has(module.specifier)) throw new KernelContractError(`${path}.modules`, `duplicate specifier ${module.specifier}`);
		specifiers.add(module.specifier);
	}
	return { version: KERNEL_INTEROP_MANIFEST_VERSION, modules: [...modules].sort((left, right) => left.specifier.localeCompare(right.specifier)) };
}

function validateInteropManifestVersion(value: unknown, path: string): typeof KERNEL_INTEROP_MANIFEST_VERSION {
	if (value !== KERNEL_INTEROP_MANIFEST_VERSION) {
		throw new KernelContractError(
			path,
			`unsupported Interop Manifest version ${describeJsonValue(value)}; expected ${JSON.stringify(KERNEL_INTEROP_MANIFEST_VERSION)}`,
		);
	}
	return KERNEL_INTEROP_MANIFEST_VERSION;
}

function describeJsonValue(value: unknown): string {
	const encoded = JSON.stringify(value);
	return encoded === undefined ? typeof value : encoded;
}

function validateEmit(value: unknown, path: string): KernelEmitOptionsV1 {
	const emit = record(value, path);
	exactKeys(emit, ['target', 'sourceMap', 'sourcesContent'], path);
	literal(emit.target, 'es2022', `${path}.target`);
	return {
		target: 'es2022',
		sourceMap: boolean(emit.sourceMap, `${path}.sourceMap`),
		sourcesContent: boolean(emit.sourcesContent, `${path}.sourcesContent`),
	};
}

function validateStats(value: unknown, path: string): KernelCompilationStatsV1 {
	const stats = record(value, path);
	const keys = ['parsedModules', 'reusedParsedModules', 'checkedModules', 'reusedCheckedModules', 'emittedModules', 'reusedEmittedModules', 'invalidatedModules'] as const;
	exactKeys(stats, keys, path);
	return {
		parsedModules: nonNegativeInteger(stats.parsedModules, `${path}.parsedModules`),
		reusedParsedModules: nonNegativeInteger(stats.reusedParsedModules, `${path}.reusedParsedModules`),
		checkedModules: nonNegativeInteger(stats.checkedModules, `${path}.checkedModules`),
		reusedCheckedModules: nonNegativeInteger(stats.reusedCheckedModules, `${path}.reusedCheckedModules`),
		emittedModules: nonNegativeInteger(stats.emittedModules, `${path}.emittedModules`),
		reusedEmittedModules: nonNegativeInteger(stats.reusedEmittedModules, `${path}.reusedEmittedModules`),
		invalidatedModules: nonNegativeInteger(stats.invalidatedModules, `${path}.invalidatedModules`),
	};
}

function assertJsonData(value: unknown, path: string, seen = new WeakSet<object>()): void {
	if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
	if (typeof value === 'number') {
		if (!Number.isFinite(value)) throw new KernelContractError(path, 'number must be finite');
		return;
	}
	if (typeof value !== 'object') throw new KernelContractError(path, `value must be JSON data, received ${typeof value}`);
	if (seen.has(value)) throw new KernelContractError(path, 'cyclic values are not allowed');
	seen.add(value);
	if (Array.isArray(value)) {
		for (let index = 0; index < value.length; index++) assertJsonData(value[index], `${path}[${index}]`, seen);
		seen.delete(value);
		return;
	}
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) throw new KernelContractError(path, 'class instances, Error, Map, Set, and host objects are not allowed');
	for (const [key, child] of Object.entries(value)) assertJsonData(child, `${path}.${key}`, seen);
	seen.delete(value);
}

function canonicalJsonObject(value: Record<string, unknown>): JsonObject {
	const output: Record<string, JsonValue> = {};
	for (const key of Object.keys(value).sort()) {
		const child = value[key];
		if (Array.isArray(child)) output[key] = child.map(item => canonicalJsonValue(item));
		else output[key] = canonicalJsonValue(child);
	}
	return output;
}

function canonicalJsonValue(value: unknown): JsonValue {
	if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') return value;
	if (Array.isArray(value)) return value.map(item => canonicalJsonValue(item));
	return canonicalJsonObject(record(value, '$json'));
}

function cloneJson(value: unknown): JsonValue {
	return JSON.parse(JSON.stringify(value)) as JsonValue;
}

function record(value: unknown, path: string): Record<string, unknown> {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new KernelContractError(path, 'expected an object');
	return value as Record<string, unknown>;
}

function array(value: unknown, path: string): readonly unknown[] {
	if (!Array.isArray(value)) throw new KernelContractError(path, 'expected an array');
	return value;
}

function string(value: unknown, path: string): string {
	if (typeof value !== 'string') throw new KernelContractError(path, 'expected a string');
	return value;
}

function nonEmptyString(value: unknown, path: string): string {
	const result = string(value, path);
	if (result.length === 0) throw new KernelContractError(path, 'string must not be empty');
	return result;
}

function boolean(value: unknown, path: string): boolean {
	if (typeof value !== 'boolean') throw new KernelContractError(path, 'expected a boolean');
	return value;
}

function nonNegativeInteger(value: unknown, path: string): number {
	if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) throw new KernelContractError(path, 'expected a non-negative integer');
	return value;
}

function literal<T extends string>(value: unknown, expected: T, path: string): T {
	if (value !== expected) throw new KernelContractError(path, `expected ${JSON.stringify(expected)}`);
	return expected;
}

function oneOf<const T extends readonly string[]>(value: unknown, allowed: T, path: string): T[number] {
	if (typeof value !== 'string' || !allowed.includes(value)) throw new KernelContractError(path, `expected one of ${allowed.join(', ')}`);
	return value as T[number];
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], path: string): void {
	const allowedSet = new Set(allowed);
	for (const key of Object.keys(value)) if (!allowedSet.has(key)) throw new KernelContractError(`${path}.${key}`, 'unknown property');
	for (const key of allowed) if (!Object.hasOwn(value, key)) throw new KernelContractError(`${path}.${key}`, 'missing property');
}
