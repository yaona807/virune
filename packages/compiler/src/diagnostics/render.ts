import { DIAGNOSTIC_SCHEMA_VERSION, DIAGNOSTIC_SOURCE, diagnosticCategory, qualifyDiagnosticCode, type DiagnosticCategory } from './codes.js';
import type { Diagnostic } from './diagnostic.js';
import type { SourceFile, SourceSpan } from '../source.js';

export interface JsonDiagnosticPosition {
	readonly line: number;
	readonly column: number;
}

export interface JsonDiagnosticRange {
	readonly start: JsonDiagnosticPosition;
	readonly end: JsonDiagnosticPosition;
}

export interface JsonRelatedDiagnostic {
	readonly message: string;
	readonly file: string;
	readonly range: JsonDiagnosticRange;
}

export interface JsonDiagnosticCause {
	readonly kind: 'unknown' | 'internal';
	readonly message: string;
	readonly name?: string;
	readonly stack?: string;
}

export interface JsonDiagnostic {
	readonly source: typeof DIAGNOSTIC_SOURCE;
	readonly code: string;
	readonly qualifiedCode: string;
	readonly category: DiagnosticCategory;
	readonly severity: Diagnostic['severity'];
	readonly message: string;
	readonly file: string;
	readonly range: JsonDiagnosticRange;
	readonly related: readonly JsonRelatedDiagnostic[];
	readonly help: string | null;
	readonly fixIds: readonly string[];
	readonly cause: JsonDiagnosticCause | null;
}

export interface JsonDiagnosticDocument {
	readonly schemaVersion: typeof DIAGNOSTIC_SCHEMA_VERSION;
	readonly diagnostics: readonly JsonDiagnostic[];
}

export function renderDiagnostic(diagnostic: Diagnostic, file: SourceFile): string {
	const line = file.text.split(/\r?\n/u)[diagnostic.span.start.line - 1] ?? '';
	const width = Math.max(1, diagnostic.span.end.column - diagnostic.span.start.column);
	const marker = `${' '.repeat(Math.max(0, diagnostic.span.start.column - 1))}${'^'.repeat(width)}`;
	const help = diagnostic.help === undefined ? '' : `\n\nhelp: ${diagnostic.help}`;
	return `${diagnostic.severity}[${diagnostic.code}]: ${diagnostic.message}\n\n  ${file.path}:${diagnostic.span.start.line}:${diagnostic.span.start.column}\n   |\n${String(diagnostic.span.start.line).padStart(3)} | ${line}\n   | ${marker}${help}`;
}

export function diagnosticsToDocument(diagnostics: readonly Diagnostic[], files: ReadonlyMap<number, SourceFile>): JsonDiagnosticDocument {
	return {
		schemaVersion: DIAGNOSTIC_SCHEMA_VERSION,
		diagnostics: diagnostics.map(diagnostic => {
			const file = files.get(diagnostic.span.fileId);
			return {
				source: DIAGNOSTIC_SOURCE,
				code: diagnostic.code,
				qualifiedCode: qualifyDiagnosticCode(diagnostic.code),
				category: diagnosticCategory(diagnostic.code) ?? 'internal',
				severity: diagnostic.severity,
				message: diagnostic.message,
				file: file?.path ?? '<unknown>',
				range: jsonRange(diagnostic.span),
				related: (diagnostic.related ?? []).map(item => ({
					message: item.message,
					file: files.get(item.span.fileId)?.path ?? '<unknown>',
					range: jsonRange(item.span),
				})),
				help: diagnostic.help ?? null,
				fixIds: (diagnostic.fixes ?? []).map((fix, index) => fix.id ?? `${qualifyDiagnosticCode(diagnostic.code)}/fix-${index + 1}`),
				cause: diagnostic.cause ?? null,
			};
		}),
	};
}

export function diagnosticsToJson(diagnostics: readonly Diagnostic[], files: ReadonlyMap<number, SourceFile>): string {
	return JSON.stringify(diagnosticsToDocument(diagnostics, files), null, 2);
}

function jsonRange(span: SourceSpan): JsonDiagnosticRange {
	return {
		start: { line: span.start.line, column: span.start.column },
		end: { line: span.end.line, column: span.end.column },
	};
}
