import type { Diagnostic as ViruneDiagnostic, SourceFile } from '@virune/compiler/experimental';
import {
	DiagnosticSeverity,
	type Diagnostic,
	type DiagnosticRelatedInformation,
} from 'vscode-languageserver/node';
import type { DocumentAnalysisSnapshot } from '../analysis/project-manager.js';
import { filePathToUri, sourceSpanToRange } from '../analysis/position.js';

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
		source: 'virune',
		message: diagnostic.message,
		...(relatedInformation === undefined ? {} : { relatedInformation }),
	};
}

function severity(value: ViruneDiagnostic['severity']): DiagnosticSeverity {
	switch (value) {
		case 'error': return DiagnosticSeverity.Error;
		case 'warning': return DiagnosticSeverity.Warning;
		case 'info': return DiagnosticSeverity.Information;
	}
}
