import { validateKernelInput, type KernelInputV1 } from './contract.js';
import {
	SelfhostMvpError,
	type SelfhostMvpModule,
	type ViruneResultValue,
} from './mvp-adapter.js';

export const PROJECT_COMPILER_CONTRACT_VERSION = '1' as const;
export const PROJECT_COMPILER_REQUEST_SCHEMA = 'virune.selfhost.project-compiler.request.v1' as const;
export const PROJECT_COMPILER_RESULT_SCHEMA = 'virune.selfhost.project-compiler.result.v1' as const;

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

export interface ProjectCompilerDiagnosticV1 {
	readonly code: string;
	readonly severity: 'error';
	readonly message: string;
}

export interface ProjectCompilerResultV1 {
	readonly contractVersion: typeof PROJECT_COMPILER_CONTRACT_VERSION;
	readonly accepted: boolean;
	readonly diagnostics: readonly ProjectCompilerDiagnosticV1[];
	readonly emittedModuleCount: number;
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
	return validateProjectCompilerResult(JSON.parse(encoded) as unknown);
}

function validateProjectCompilerInput(value: unknown): KernelInputV1 {
	const input = validateKernelInput(value);
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
	if (new Set(blockers).size !== blockers.length) throw new SelfhostMvpError('$.blockers must be unique');
	if (JSON.stringify([...blockers].sort()) !== JSON.stringify(blockers)) {
		throw new SelfhostMvpError('$.blockers must be sorted');
	}
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

function validateProjectCompilerResult(value: unknown): ProjectCompilerResultV1 {
	const record = object(value, '$');
	exactKeys(record, ['contractVersion', 'accepted', 'diagnostics', 'emittedModuleCount'], '$');
	if (record.contractVersion !== PROJECT_COMPILER_CONTRACT_VERSION) {
		throw new SelfhostMvpError('$.contractVersion must be project compiler contract version 1');
	}
	if (typeof record.accepted !== 'boolean') throw new SelfhostMvpError('$.accepted must be boolean');
	if (!Array.isArray(record.diagnostics)) throw new SelfhostMvpError('$.diagnostics must be an array');
	const emittedModuleCount = integer(record.emittedModuleCount, '$.emittedModuleCount', 0);
	const diagnostics = record.diagnostics.map((item, index) => validateDiagnostic(item, `$.diagnostics[${index}]`));
	if (record.accepted && diagnostics.some(item => item.severity === 'error')) {
		throw new SelfhostMvpError('accepted project compiler result cannot contain errors');
	}
	if (!record.accepted && diagnostics.length === 0) {
		throw new SelfhostMvpError('rejected project compiler result must contain a diagnostic');
	}
	if (!record.accepted && emittedModuleCount !== 0) {
		throw new SelfhostMvpError('rejected project compiler result cannot emit modules');
	}
	return {
		contractVersion: PROJECT_COMPILER_CONTRACT_VERSION,
		accepted: record.accepted,
		diagnostics,
		emittedModuleCount,
	};
}

function validateDiagnostic(value: unknown, path: string): ProjectCompilerDiagnosticV1 {
	const record = object(value, path);
	exactKeys(record, ['code', 'severity', 'message'], path);
	if (record.severity !== 'error') throw new SelfhostMvpError(`${path}.severity must be error`);
	return {
		code: text(record.code, `${path}.code`),
		severity: 'error',
		message: text(record.message, `${path}.message`),
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

function text(value: unknown, path: string): string {
	if (typeof value !== 'string' || value.length === 0) throw new SelfhostMvpError(`${path} must be non-empty string`);
	return value;
}

function integer(value: unknown, path: string, minimum: number): number {
	if (!Number.isInteger(value) || (value as number) < minimum) {
		throw new SelfhostMvpError(`${path} must be an integer >= ${minimum}`);
	}
	return value as number;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], path: string): void {
	const expected = [...keys].sort();
	const actual = Object.keys(value).sort();
	if (JSON.stringify(actual) !== JSON.stringify(expected)) {
		throw new SelfhostMvpError(`${path} keys must be exactly ${expected.join(', ')}`);
	}
}
