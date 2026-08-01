import {
	KERNEL_LANGUAGE_VERSION,
	normalizeKernelPath,
	validateKernelInput,
	type KernelInputV1,
} from './contract.js';
import {
	SelfhostMvpError,
	type SelfhostMvpModule,
	type ViruneResultValue,
} from './mvp-adapter.js';

export const PROJECT_COMPILER_CONTRACT_VERSION = '1' as const;
export const PROJECT_COMPILER_REQUEST_SCHEMA = 'virune.selfhost.project-compiler.request.v1' as const;
export const PROJECT_COMPILER_RESULT_SCHEMA = 'virune.selfhost.project-compiler.result.v2' as const;

export interface SelfhostProjectCompilerModule extends SelfhostMvpModule {
	readonly projectCompilerCapability: () => ViruneResultValue<string>;
	readonly compileProjectMvp: (request: string) => ViruneResultValue<string>;
}

export interface ProjectCompilerCapabilityV1 {
	readonly contractVersion: typeof PROJECT_COMPILER_CONTRACT_VERSION;
	readonly ready: boolean;
	readonly requestSchema: typeof PROJECT_COMPILER_REQUEST_SCHEMA;
	readonly resultSchema: typeof PROJECT_COMPILER_RESULT_SCHEMA;
	readonly blockers: readonly string[];
}

export interface ProjectCompilerPositionV1 {
	readonly offset: number;
	readonly line: number;
	readonly column: number;
}

export interface ProjectCompilerSpanV1 {
	readonly start: ProjectCompilerPositionV1;
	readonly end: ProjectCompilerPositionV1;
}

export interface ProjectCompilerDiagnosticV1 {
	readonly code: string;
	readonly severity: 'error';
	readonly message: string;
	readonly sourcePath: string | null;
	readonly span: ProjectCompilerSpanV1;
	readonly notes: readonly string[];
}

export interface ProjectCompilerEmittedModuleV1 {
	readonly sourcePath: string;
	readonly outputPath: string;
	readonly code: string;
	readonly sourceMap: string;
}

export interface ProjectCompilerDependencyV1 {
	readonly modulePath: string;
	readonly sourceKind: 'virune' | 'javascript';
	readonly specifier: string;
	readonly resolvedPath: string | null;
	readonly typeOnly: boolean;
	readonly public: boolean;
}

export interface ProjectCompilerExportedSymbolV1 {
	readonly modulePath: string;
	readonly name: string;
	readonly declarationKind: string;
}

export interface ProjectCompilerStatsV1 {
	readonly parsedModules: number;
	readonly reusedParsedModules: number;
	readonly checkedModules: number;
	readonly reusedCheckedModules: number;
	readonly emittedModules: number;
	readonly reusedEmittedModules: number;
	readonly invalidatedModules: number;
}

export interface ProjectCompilerResultV1 {
	readonly contractVersion: typeof PROJECT_COMPILER_CONTRACT_VERSION;
	readonly languageVersion: typeof KERNEL_LANGUAGE_VERSION;
	readonly platform: 'node';
	readonly entryPath: string;
	readonly accepted: boolean;
	readonly diagnostics: readonly ProjectCompilerDiagnosticV1[];
	readonly emittedModules: readonly ProjectCompilerEmittedModuleV1[];
	readonly dependencies: readonly ProjectCompilerDependencyV1[];
	readonly exportedSymbols: readonly ProjectCompilerExportedSymbolV1[];
	readonly stats: ProjectCompilerStatsV1;
}

export function hasSelfhostProjectCompilerExports(
	module: SelfhostMvpModule,
): module is SelfhostProjectCompilerModule {
	const candidate = module as {
		readonly projectCompilerCapability?: unknown;
		readonly compileProjectMvp?: unknown;
	};
	return typeof candidate.projectCompilerCapability === 'function'
		&& typeof candidate.compileProjectMvp === 'function';
}

export function readProjectCompilerCapability(
	module: SelfhostMvpModule,
): ProjectCompilerCapabilityV1 | null {
	if (!hasSelfhostProjectCompilerExports(module)) return null;
	const encoded = unwrapResult(
		module.projectCompilerCapability(),
		'Virune project compiler capability failed',
	);
	return validateCapability(JSON.parse(encoded) as unknown);
}

export function compileWithProjectCompilerBoundary(
	module: SelfhostMvpModule,
	value: unknown,
): ProjectCompilerResultV1 {
	if (!hasSelfhostProjectCompilerExports(module)) {
		throw new SelfhostMvpError('Self-host compiler does not export the project compiler boundary');
	}
	const input = validateProjectCompilerInput(value);
	const encoded = unwrapResult(
		module.compileProjectMvp(JSON.stringify({
			contractVersion: input.contractVersion,
			languageVersion: input.languageVersion,
			platform: input.platform,
			entryPath: input.entryPath,
			sources: input.sources.map(source => ({ path: source.path, text: source.text })),
			emit: input.emit,
		})),
		'Virune project compiler request failed',
	);
	return validateProjectCompilerResult(JSON.parse(encoded) as unknown, input);
}

function validateProjectCompilerInput(value: unknown): KernelInputV1 {
	const input = validateKernelInput(value);
	if (input.platform !== 'node') {
		throw new SelfhostMvpError('Project compiler capability v1 requires the node platform');
	}
	if (input.interopManifest.modules.length !== 0) {
		throw new SelfhostMvpError('Project compiler capability v1 does not accept JavaScript interop yet');
	}
	return input;
}

function validateCapability(value: unknown): ProjectCompilerCapabilityV1 {
	const record = object(value, '$');
	exactKeys(record, ['contractVersion', 'ready', 'requestSchema', 'resultSchema', 'blockers'], '$');
	if (record.contractVersion !== PROJECT_COMPILER_CONTRACT_VERSION) {
		throw new SelfhostMvpError('$.contractVersion must be project compiler contract version 1');
	}
	if (record.requestSchema !== PROJECT_COMPILER_REQUEST_SCHEMA) {
		throw new SelfhostMvpError(`$.requestSchema must be ${PROJECT_COMPILER_REQUEST_SCHEMA}`);
	}
	if (record.resultSchema !== PROJECT_COMPILER_RESULT_SCHEMA) {
		throw new SelfhostMvpError(`$.resultSchema must be ${PROJECT_COMPILER_RESULT_SCHEMA}`);
	}
	if (typeof record.ready !== 'boolean') throw new SelfhostMvpError('$.ready must be boolean');
	if (!Array.isArray(record.blockers)) throw new SelfhostMvpError('$.blockers must be an array');
	const blockers = record.blockers.map((item, index) => text(item, `$.blockers[${index}]`));
	assertCanonical(blockers, item => item, '$.blockers');
	if (record.ready && blockers.length > 0) throw new SelfhostMvpError('ready capability cannot contain blockers');
	if (!record.ready && blockers.length === 0) throw new SelfhostMvpError('non-ready capability must contain a blocker');
	return {
		contractVersion: PROJECT_COMPILER_CONTRACT_VERSION,
		ready: record.ready,
		requestSchema: PROJECT_COMPILER_REQUEST_SCHEMA,
		resultSchema: PROJECT_COMPILER_RESULT_SCHEMA,
		blockers,
	};
}

function validateProjectCompilerResult(
	value: unknown,
	input: KernelInputV1,
): ProjectCompilerResultV1 {
	const record = object(value, '$');
	exactKeys(record, [
		'contractVersion',
		'languageVersion',
		'platform',
		'entryPath',
		'accepted',
		'diagnostics',
		'emittedModules',
		'dependencies',
		'exportedSymbols',
		'stats',
	], '$');
	if (record.contractVersion !== PROJECT_COMPILER_CONTRACT_VERSION) {
		throw new SelfhostMvpError('$.contractVersion must be project compiler contract version 1');
	}
	if (record.languageVersion !== KERNEL_LANGUAGE_VERSION) {
		throw new SelfhostMvpError(`$.languageVersion must be ${KERNEL_LANGUAGE_VERSION}`);
	}
	if (record.platform !== 'node') throw new SelfhostMvpError('$.platform must be node');
	const entryPath = canonicalPath(record.entryPath, '$.entryPath');
	if (entryPath !== input.entryPath) throw new SelfhostMvpError('$.entryPath must match the request entryPath');
	if (typeof record.accepted !== 'boolean') throw new SelfhostMvpError('$.accepted must be boolean');
	const diagnostics = array(record.diagnostics, '$.diagnostics')
		.map((item, index) => validateDiagnostic(item, `$.diagnostics[${index}]`));
	const emittedModules = array(record.emittedModules, '$.emittedModules')
		.map((item, index) => validateEmittedModule(item, `$.emittedModules[${index}]`));
	const dependencies = array(record.dependencies, '$.dependencies')
		.map((item, index) => validateDependency(item, `$.dependencies[${index}]`));
	const exportedSymbols = array(record.exportedSymbols, '$.exportedSymbols')
		.map((item, index) => validateExportedSymbol(item, `$.exportedSymbols[${index}]`));
	const stats = validateStats(record.stats, '$.stats');

	const inputPaths = new Set(input.sources.map(source => source.path));
	for (const diagnostic of diagnostics) {
		if (diagnostic.sourcePath !== null && !inputPaths.has(diagnostic.sourcePath)) {
			throw new SelfhostMvpError('$.diagnostics sourcePath must identify a request source');
		}
	}
	assertCanonical(emittedModules, item => item.outputPath, '$.emittedModules');
	assertCanonical(
		dependencies,
		item => `${item.modulePath}\0${item.sourceKind}\0${item.specifier}`,
		'$.dependencies',
	);
	assertCanonical(
		exportedSymbols,
		item => `${item.modulePath}\0${item.name}\0${item.declarationKind}`,
		'$.exportedSymbols',
	);
	if (stats.parsedModules + stats.reusedParsedModules !== input.sources.length) {
		throw new SelfhostMvpError('parsed and reused parsed module counts must cover every request source');
	}
	if (stats.emittedModules !== emittedModules.length) {
		throw new SelfhostMvpError('$.stats.emittedModules must match $.emittedModules length');
	}
	if (record.accepted && diagnostics.some(item => item.severity === 'error')) {
		throw new SelfhostMvpError('accepted project compiler result cannot contain errors');
	}
	if (!record.accepted && diagnostics.length === 0) {
		throw new SelfhostMvpError('rejected project compiler result must contain a diagnostic');
	}
	if (!record.accepted && emittedModules.length !== 0) {
		throw new SelfhostMvpError('rejected project compiler result cannot emit modules');
	}
	return {
		contractVersion: PROJECT_COMPILER_CONTRACT_VERSION,
		languageVersion: KERNEL_LANGUAGE_VERSION,
		platform: 'node',
		entryPath,
		accepted: record.accepted,
		diagnostics,
		emittedModules,
		dependencies,
		exportedSymbols,
		stats,
	};
}

function validateDiagnostic(value: unknown, path: string): ProjectCompilerDiagnosticV1 {
	const record = object(value, path);
	exactKeys(record, ['code', 'severity', 'message', 'sourcePath', 'span', 'notes'], path);
	if (record.severity !== 'error') throw new SelfhostMvpError(`${path}.severity must be error`);
	const sourcePath = record.sourcePath === null
		? null
		: canonicalPath(record.sourcePath, `${path}.sourcePath`);
	return {
		code: text(record.code, `${path}.code`),
		severity: 'error',
		message: text(record.message, `${path}.message`),
		sourcePath,
		span: validateSpan(record.span, `${path}.span`),
		notes: array(record.notes, `${path}.notes`).map((item, index) => text(item, `${path}.notes[${index}]`)),
	};
}

function validateSpan(value: unknown, path: string): ProjectCompilerSpanV1 {
	const record = object(value, path);
	exactKeys(record, ['start', 'end'], path);
	const start = validatePosition(record.start, `${path}.start`);
	const end = validatePosition(record.end, `${path}.end`);
	if (end.offset < start.offset) throw new SelfhostMvpError(`${path}.end must not precede start`);
	return { start, end };
}

function validatePosition(value: unknown, path: string): ProjectCompilerPositionV1 {
	const record = object(value, path);
	exactKeys(record, ['offset', 'line', 'column'], path);
	return {
		offset: integer(record.offset, `${path}.offset`, 0),
		line: integer(record.line, `${path}.line`, 1),
		column: integer(record.column, `${path}.column`, 1),
	};
}

function validateEmittedModule(value: unknown, path: string): ProjectCompilerEmittedModuleV1 {
	const record = object(value, path);
	exactKeys(record, ['sourcePath', 'outputPath', 'code', 'sourceMap'], path);
	return {
		sourcePath: canonicalPath(record.sourcePath, `${path}.sourcePath`),
		outputPath: canonicalPath(record.outputPath, `${path}.outputPath`),
		code: string(record.code, `${path}.code`),
		sourceMap: string(record.sourceMap, `${path}.sourceMap`),
	};
}

function validateDependency(value: unknown, path: string): ProjectCompilerDependencyV1 {
	const record = object(value, path);
	exactKeys(record, ['modulePath', 'sourceKind', 'specifier', 'resolvedPath', 'typeOnly', 'public'], path);
	if (record.sourceKind !== 'virune' && record.sourceKind !== 'javascript') {
		throw new SelfhostMvpError(`${path}.sourceKind must be virune or javascript`);
	}
	const resolvedPath = record.resolvedPath === null
		? null
		: canonicalPath(record.resolvedPath, `${path}.resolvedPath`);
	return {
		modulePath: canonicalPath(record.modulePath, `${path}.modulePath`),
		sourceKind: record.sourceKind,
		specifier: text(record.specifier, `${path}.specifier`),
		resolvedPath,
		typeOnly: boolean(record.typeOnly, `${path}.typeOnly`),
		public: boolean(record.public, `${path}.public`),
	};
}

function validateExportedSymbol(value: unknown, path: string): ProjectCompilerExportedSymbolV1 {
	const record = object(value, path);
	exactKeys(record, ['modulePath', 'name', 'declarationKind'], path);
	return {
		modulePath: canonicalPath(record.modulePath, `${path}.modulePath`),
		name: text(record.name, `${path}.name`),
		declarationKind: text(record.declarationKind, `${path}.declarationKind`),
	};
}

function validateStats(value: unknown, path: string): ProjectCompilerStatsV1 {
	const record = object(value, path);
	exactKeys(record, [
		'parsedModules',
		'reusedParsedModules',
		'checkedModules',
		'reusedCheckedModules',
		'emittedModules',
		'reusedEmittedModules',
		'invalidatedModules',
	], path);
	return {
		parsedModules: integer(record.parsedModules, `${path}.parsedModules`, 0),
		reusedParsedModules: integer(record.reusedParsedModules, `${path}.reusedParsedModules`, 0),
		checkedModules: integer(record.checkedModules, `${path}.checkedModules`, 0),
		reusedCheckedModules: integer(record.reusedCheckedModules, `${path}.reusedCheckedModules`, 0),
		emittedModules: integer(record.emittedModules, `${path}.emittedModules`, 0),
		reusedEmittedModules: integer(record.reusedEmittedModules, `${path}.reusedEmittedModules`, 0),
		invalidatedModules: integer(record.invalidatedModules, `${path}.invalidatedModules`, 0),
	};
}

function unwrapResult<T>(result: ViruneResultValue<T>, message: string): T {
	if (result === null || typeof result !== 'object') throw new SelfhostMvpError(`${message}: invalid Result object`);
	if (result.$tag !== 'Ok' && result.$tag !== 'Err') throw new SelfhostMvpError(`${message}: invalid Result tag`);
	if (!Array.isArray(result.$values) || result.$values.length !== 1) {
		throw new SelfhostMvpError(`${message}: invalid Result values`);
	}
	const value = result.$values[0];
	if (result.$tag === 'Ok') return value as T;
	throw new SelfhostMvpError(message, value);
}

function object(value: unknown, path: string): Record<string, unknown> {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		throw new SelfhostMvpError(`${path} must be an object`);
	}
	return value as Record<string, unknown>;
}

function array(value: unknown, path: string): readonly unknown[] {
	if (!Array.isArray(value)) throw new SelfhostMvpError(`${path} must be an array`);
	return value;
}

function string(value: unknown, path: string): string {
	if (typeof value !== 'string') throw new SelfhostMvpError(`${path} must be a string`);
	return value;
}

function text(value: unknown, path: string): string {
	const result = string(value, path);
	if (result.length === 0) throw new SelfhostMvpError(`${path} must be non-empty string`);
	return result;
}

function boolean(value: unknown, path: string): boolean {
	if (typeof value !== 'boolean') throw new SelfhostMvpError(`${path} must be boolean`);
	return value;
}

function integer(value: unknown, path: string, minimum: number): number {
	if (!Number.isInteger(value) || (value as number) < minimum) {
		throw new SelfhostMvpError(`${path} must be an integer >= ${minimum}`);
	}
	return value as number;
}

function canonicalPath(value: unknown, path: string): string {
	try {
		return normalizeKernelPath(string(value, path), path);
	} catch (error) {
		throw new SelfhostMvpError(error instanceof Error ? error.message : `${path} must be a canonical path`);
	}
}

function assertCanonical<T>(values: readonly T[], key: (value: T) => string, path: string): void {
	const keys = values.map(key);
	if (new Set(keys).size !== keys.length) throw new SelfhostMvpError(`${path} must be unique`);
	const sorted = [...keys].sort(compareText);
	if (JSON.stringify(keys) !== JSON.stringify(sorted)) throw new SelfhostMvpError(`${path} must be sorted`);
}

function compareText(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], path: string): void {
	const expected = [...keys].sort(compareText);
	const actual = Object.keys(value).sort(compareText);
	if (JSON.stringify(actual) !== JSON.stringify(expected)) {
		throw new SelfhostMvpError(`${path} keys must be exactly ${expected.join(', ')}`);
	}
}
