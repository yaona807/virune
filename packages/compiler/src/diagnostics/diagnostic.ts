import type { SourceSpan } from '../source.js';

export type DiagnosticSeverity = 'error' | 'warning' | 'info';

export interface DiagnosticFix {
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
	readonly fixes?: readonly DiagnosticFix[];
}

export class DiagnosticBag {
	readonly #diagnostics: Diagnostic[] = [];
	public add(diagnostic: Diagnostic): void {
		if (this.#diagnostics.length < 100) this.#diagnostics.push(diagnostic);
	}
	public error(code: string, message: string, span: SourceSpan, options: Omit<Diagnostic, 'code' | 'message' | 'span' | 'severity'> = {}): void {
		this.add({ code, severity: 'error', message, span, ...options });
	}
	public warning(code: string, message: string, span: SourceSpan, options: Omit<Diagnostic, 'code' | 'message' | 'span' | 'severity'> = {}): void {
		this.add({ code, severity: 'warning', message, span, ...options });
	}
	public get items(): readonly Diagnostic[] { return this.#diagnostics; }
	public get hasErrors(): boolean { return this.#diagnostics.some(item => item.severity === 'error'); }
}
