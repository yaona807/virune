import type { Diagnostic } from './diagnostic.js';
import type { SourceFile } from '../source.js';

export function renderDiagnostic(diagnostic: Diagnostic, file: SourceFile): string {
	const line = file.text.split(/\r?\n/u)[diagnostic.span.start.line - 1] ?? '';
	const width = Math.max(1, diagnostic.span.end.column - diagnostic.span.start.column);
	const marker = `${' '.repeat(Math.max(0, diagnostic.span.start.column - 1))}${'^'.repeat(width)}`;
	return `${diagnostic.severity}[${diagnostic.code}]: ${diagnostic.message}\n\n  ${file.path}:${diagnostic.span.start.line}:${diagnostic.span.start.column}\n   |\n${String(diagnostic.span.start.line).padStart(3)} | ${line}\n   | ${marker}`;
}

export function diagnosticsToJson(diagnostics: readonly Diagnostic[], files: ReadonlyMap<number, SourceFile>): string {
	return JSON.stringify({
		schemaVersion: 1,
		diagnostics: diagnostics.map(diagnostic => {
			const file = files.get(diagnostic.span.fileId);
			return {
				code: diagnostic.code,
				severity: diagnostic.severity,
				message: diagnostic.message,
				file: file?.path ?? '<unknown>',
				range: {
					start: { line: diagnostic.span.start.line, column: diagnostic.span.start.column },
					end: { line: diagnostic.span.end.line, column: diagnostic.span.end.column },
				},
				related: diagnostic.related ?? [],
				fixes: diagnostic.fixes ?? [],
			};
		}),
	}, null, 2);
}
