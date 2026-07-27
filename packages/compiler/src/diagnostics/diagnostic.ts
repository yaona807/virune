import type { SourceSpan } from '../source.js';

export type DiagnosticSeverity = 'error' | 'warning' | 'information' | 'hint';

export interface DiagnosticCause {
	readonly kind: 'unknown' | 'internal';
	readonly message: string;
	readonly name?: string;
	readonly stack?: string;
}

export interface DiagnosticFix {
	readonly id?: string;
	readonly title: string;
	readonly kind: 'insert' | 'replace' | 'remove' | 'rewrite';
	readonly span?: SourceSpan;
	readonly text?: string;
}

export interface RelatedDiagnostic {
	readonly message: string;
	readonly span: SourceSpan;
}

export interface Diagnostic {
	readonly code: string;
	readonly severity: DiagnosticSeverity;
	readonly message: string;
	readonly span: SourceSpan;
	readonly related?: readonly RelatedDiagnostic[];
	readonly help?: string;
	readonly fixes?: readonly DiagnosticFix[];
	readonly cause?: DiagnosticCause;
}

export class DiagnosticBag {
	readonly #diagnostics: Diagnostic[] = [];
	public add(diagnostic: Diagnostic): void {
		if (this.#diagnostics.length < 100) this.#diagnostics.push({ ...diagnostic, span: normalizeSpan(diagnostic.span) });
	}
	public error(code: string, message: string, span: SourceSpan, options: Omit<Diagnostic, 'code' | 'message' | 'span' | 'severity'> = {}): void {
		this.add({ code, severity: 'error', message, span, ...options });
	}
	public warning(code: string, message: string, span: SourceSpan, options: Omit<Diagnostic, 'code' | 'message' | 'span' | 'severity'> = {}): void {
		this.add({ code, severity: 'warning', message, span, ...options });
	}
	public information(code: string, message: string, span: SourceSpan, options: Omit<Diagnostic, 'code' | 'message' | 'span' | 'severity'> = {}): void {
		this.add({ code, severity: 'information', message, span, ...options });
	}
	public hint(code: string, message: string, span: SourceSpan, options: Omit<Diagnostic, 'code' | 'message' | 'span' | 'severity'> = {}): void {
		this.add({ code, severity: 'hint', message, span, ...options });
	}
	public get items(): readonly Diagnostic[] { return this.#diagnostics; }
	public get hasErrors(): boolean { return this.#diagnostics.some(item => item.severity === 'error'); }
}

function normalizeSpan(span: SourceSpan): SourceSpan {
	const startOffset = finiteAtLeast(span.start.offset, 0);
	const startLine = finiteAtLeast(span.start.line, 1);
	const startColumn = finiteAtLeast(span.start.column, 1);
	return {
		fileId: span.fileId,
		start: { offset: startOffset, line: startLine, column: startColumn },
		end: {
			offset: finiteAtLeast(span.end.offset, startOffset),
			line: finiteAtLeast(span.end.line, startLine),
			column: finiteAtLeast(span.end.column, startColumn),
		},
	};
}

function finiteAtLeast(value: number, minimum: number): number {
	return Number.isFinite(value) && value >= minimum ? value : minimum;
}

export function diagnosticCause(error: unknown, kind: DiagnosticCause['kind'] = 'internal'): DiagnosticCause {
	if (error instanceof Error) {
		return {
			kind,
			message: error.message,
			...(error.name === '' ? {} : { name: error.name }),
			...(error.stack === undefined ? {} : { stack: error.stack }),
		};
	}
	return { kind, message: String(error) };
}
