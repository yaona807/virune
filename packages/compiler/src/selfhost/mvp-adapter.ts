import { BASE_RUNTIME_IMPORT_LINE } from '../codegen/runtime-imports.js';
import {
	KERNEL_CONTRACT_VERSION,
	KERNEL_LANGUAGE_VERSION,
	validateKernelInput,
	validateKernelOutput,
	type KernelDiagnosticV1,
	type KernelInputV1,
	type KernelOutputV1,
	type KernelSpanV1,
} from './contract.js';
import type { DifferentialKernelV1 } from './differential-harness.js';

export interface ViruneResultValue<T, E = unknown> {
	readonly $tag: 'Ok' | 'Err';
	readonly $values: readonly [T] | readonly [E];
}

export interface SelfhostMvpModule {
	readonly compileMvp: (source: string) => ViruneResultValue<string>;
}

interface MvpDiagnostic {
	readonly code: string;
	readonly severity: string;
	readonly message: string;
	readonly span: KernelSpanV1;
}

interface MvpExport {
	readonly name: string;
	readonly declarationKind: string;
}

interface MvpCompilation {
	readonly accepted: boolean;
	readonly diagnostics: readonly MvpDiagnostic[];
	readonly codeBody: string;
	readonly exports: readonly MvpExport[];
}

export class SelfhostMvpError extends Error {
	public override readonly name = 'SelfhostMvpError';
	public constructor(message: string, public readonly details?: unknown) { super(message); }
}

export function createSelfhostMvpKernel(module: SelfhostMvpModule): DifferentialKernelV1 {
	return {
		name: 'selfhost-mvp',
		compile: input => compileWithSelfhostMvp(module, input),
	};
}

export const legacyMvpKernel: DifferentialKernelV1 = {
	name: 'legacy-mvp',
	compile: compileWithLegacyMvp,
};

export async function compileWithLegacyMvp(value: unknown): Promise<KernelOutputV1> {
	const input = validateMvpInput(value);
	const { compileWithLegacyKernel } = await import('./legacy-adapter.js');
	const output = await compileWithLegacyKernel(input);
	return validateKernelOutput({
		...output,
		emittedModules: output.emittedModules.map(module => ({ ...module, sourceMap: '' })),
	});
}

export async function compileWithSelfhostMvp(module: SelfhostMvpModule, value: unknown): Promise<KernelOutputV1> {
	const input = validateMvpInput(value);
	const source = input.sources[0]!;
	const encoded = unwrapResult(module.compileMvp(source.text), 'Virune MVP compilation failed');
	const compilation = validateCompilation(JSON.parse(encoded) as unknown);
	const diagnostics: readonly KernelDiagnosticV1[] = compilation.diagnostics.map(diagnostic => ({
		code: diagnostic.code,
		severity: validateSeverity(diagnostic.severity),
		message: diagnostic.message,
		sourcePath: source.path,
		span: normalizeLegacyDiagnosticSpan(diagnostic.span),
	}));
	const accepted = compilation.accepted && !diagnostics.some(diagnostic => diagnostic.severity === 'error');
	const outputPath = `.selfhost-output/${source.path.replace(/\.virune$/u, '.js')}`;
	const output: KernelOutputV1 = {
		contractVersion: KERNEL_CONTRACT_VERSION,
		languageVersion: KERNEL_LANGUAGE_VERSION,
		platform: input.platform,
		entryPath: input.entryPath,
		accepted,
		diagnostics,
		emittedModules: accepted ? [{
			sourcePath: source.path,
			outputPath,
			code: `${BASE_RUNTIME_IMPORT_LINE}\n\n${compilation.codeBody}`,
			sourceMap: '',
		}] : [],
		dependencies: [],
		exportedSymbols: compilation.exports.map(item => ({
			modulePath: source.path,
			name: item.name,
			declarationKind: item.declarationKind,
		})),
		stats: {
			parsedModules: 1,
			reusedParsedModules: 0,
			checkedModules: 1,
			reusedCheckedModules: 0,
			emittedModules: accepted ? 1 : 0,
			reusedEmittedModules: 0,
			invalidatedModules: 0,
		},
	};
	return validateKernelOutput(output);
}

/**
 * The production parser preserves Chevrotain's inclusive endOffset while its
 * line and column values denote the exclusive cursor position. The Virune MVP
 * uses exclusive offsets internally, so the Host adapts only this historical
 * contract quirk before differential comparison.
 */
function normalizeLegacyDiagnosticSpan(span: KernelSpanV1): KernelSpanV1 {
	return {
		start: span.start,
		end: {
			...span.end,
			offset: span.end.offset > span.start.offset ? span.end.offset - 1 : span.end.offset,
		},
	};
}

function validateMvpInput(value: unknown): KernelInputV1 {
	const input = validateKernelInput(value);
	if (input.sources.length !== 1) throw new SelfhostMvpError('MVP supports exactly one source module');
	if (input.entryPath !== input.sources[0]?.path) throw new SelfhostMvpError('MVP entry must be the only source module');
	if (input.interopManifest.modules.length !== 0) throw new SelfhostMvpError('MVP does not support JavaScript interop');
	if (input.platform !== 'node') throw new SelfhostMvpError('MVP differential runtime currently requires the node platform');
	if (input.emit.sourceMap) throw new SelfhostMvpError('MVP delegates source-map encoding to the Host; differential fixtures must disable source maps');
	return input;
}

function unwrapResult<T>(result: ViruneResultValue<T>, message: string): T {
	const value = result.$values[0];
	if (result.$tag === 'Ok') return value as T;
	throw new SelfhostMvpError(message, value);
}

function validateCompilation(value: unknown): MvpCompilation {
	const record = object(value, '$');
	exactKeys(record, ['accepted', 'diagnostics', 'codeBody', 'exports'], '$');
	if (typeof record.accepted !== 'boolean') throw new SelfhostMvpError('$.accepted must be boolean');
	if (typeof record.codeBody !== 'string') throw new SelfhostMvpError('$.codeBody must be string');
	if (!Array.isArray(record.diagnostics)) throw new SelfhostMvpError('$.diagnostics must be an array');
	if (!Array.isArray(record.exports)) throw new SelfhostMvpError('$.exports must be an array');
	return {
		accepted: record.accepted,
		codeBody: record.codeBody,
		diagnostics: record.diagnostics.map((item, index) => validateDiagnostic(item, `$.diagnostics[${index}]`)),
		exports: record.exports.map((item, index) => validateExport(item, `$.exports[${index}]`)),
	};
}

function validateDiagnostic(value: unknown, path: string): MvpDiagnostic {
	const record = object(value, path);
	exactKeys(record, ['code', 'severity', 'message', 'span'], path);
	return {
		code: text(record.code, `${path}.code`),
		severity: text(record.severity, `${path}.severity`),
		message: text(record.message, `${path}.message`),
		span: validateSpan(record.span, `${path}.span`),
	};
}

function validateExport(value: unknown, path: string): MvpExport {
	const record = object(value, path);
	exactKeys(record, ['name', 'declarationKind'], path);
	return {
		name: text(record.name, `${path}.name`),
		declarationKind: text(record.declarationKind, `${path}.declarationKind`),
	};
}

function validateSpan(value: unknown, path: string): KernelSpanV1 {
	const record = object(value, path);
	exactKeys(record, ['start', 'end'], path);
	return { start: validatePosition(record.start, `${path}.start`), end: validatePosition(record.end, `${path}.end`) };
}

function validatePosition(value: unknown, path: string): KernelSpanV1['start'] {
	const record = object(value, path);
	exactKeys(record, ['offset', 'line', 'column'], path);
	return {
		offset: integer(record.offset, `${path}.offset`, 0),
		line: integer(record.line, `${path}.line`, 1),
		column: integer(record.column, `${path}.column`, 1),
	};
}

function validateSeverity(value: string): KernelDiagnosticV1['severity'] {
	if (value === 'error' || value === 'warning' || value === 'information' || value === 'hint') return value;
	throw new SelfhostMvpError(`Unsupported diagnostic severity ${value}`);
}

function object(value: unknown, path: string): Record<string, unknown> {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new SelfhostMvpError(`${path} must be an object`);
	return value as Record<string, unknown>;
}

function text(value: unknown, path: string): string {
	if (typeof value !== 'string') throw new SelfhostMvpError(`${path} must be string`);
	return value;
}

function integer(value: unknown, path: string, minimum: number): number {
	if (!Number.isInteger(value) || (value as number) < minimum) throw new SelfhostMvpError(`${path} must be an integer >= ${minimum}`);
	return value as number;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], path: string): void {
	const expected = [...keys].sort();
	const actual = Object.keys(value).sort();
	if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new SelfhostMvpError(`${path} keys must be exactly ${expected.join(', ')}`);
}
