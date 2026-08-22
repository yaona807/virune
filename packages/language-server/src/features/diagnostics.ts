import { DIAGNOSTIC_SOURCE, qualifyDiagnosticCode, type Diagnostic as ViruneDiagnostic, type SourceFile } from '@virune/compiler/experimental';
import {
	DiagnosticSeverity,
	type Diagnostic,
	type DiagnosticRelatedInformation,
} from 'vscode-languageserver/node';
import type { DocumentAnalysisSnapshot } from '../analysis/project-manager.js';
import { filePathToUri, sourceSpanToRange } from '../analysis/position.js';

const diagnosticCodeReference = 'https://github.com/yaona807/virune/blob/main/packages/compiler/src/diagnostics/codes.ts';

export function diagnosticsForPath(snapshot: DocumentAnalysisSnapshot, path: string): readonly Diagnostic[] {
	const target = snapshot.modulesByPath.get(path)?.source;
	if (target === undefined) return [];
	return snapshot.result.diagnostics
		.filter(diagnostic => (diagnostic.span.fileId === 0 && path === snapshot.requestedPath)
			|| snapshot.sourcesById.get(diagnostic.span.fileId)?.path === path)
		.map(diagnostic => toLspDiagnostic(diagnostic, snapshot.sourcesById, target));
}

function toLspDiagnostic(
	diagnostic: ViruneDiagnostic,
	sourcesById: ReadonlyMap<number, SourceFile>,
	fallbackSource: SourceFile,
): Diagnostic {
	const source = sourcesById.get(diagnostic.span.fileId) ?? fallbackSource;
	const relatedInformation = diagnostic.related?.map(item => {
		const relatedSource = sourcesById.get(item.span.fileId) ?? source;
		return {
			location: {
				uri: filePathToUri(relatedSource.path),
				range: sourceSpanToRange(item.span),
			},
			message: item.message,
		} satisfies DiagnosticRelatedInformation;
	});
	return {
		range: sourceSpanToRange(diagnostic.span),
		severity: severity(diagnostic.severity),
		code: diagnostic.code,
		codeDescription: { href: diagnosticCodeReference },
		source: DIAGNOSTIC_SOURCE,
		message: diagnostic.message,
		data: {
			qualifiedCode: qualifyDiagnosticCode(diagnostic.code),
			help: diagnostic.help ?? null,
			fixIds: (diagnostic.fixes ?? []).map((fix, index) => fix.id ?? `${qualifyDiagnosticCode(diagnostic.code)}/fix-${index + 1}`),
		},
		...(relatedInformation === undefined ? {} : { relatedInformation }),
	};
}

function severity(value: ViruneDiagnostic['severity']): DiagnosticSeverity {
	switch (value) {
		case 'error': return DiagnosticSeverity.Error;
		case 'warning': return DiagnosticSeverity.Warning;
		case 'information': return DiagnosticSeverity.Information;
		case 'hint': return DiagnosticSeverity.Hint;
	}
}
