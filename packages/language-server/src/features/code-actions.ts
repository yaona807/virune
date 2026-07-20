import type { Diagnostic as ViruneDiagnostic, DiagnosticFix, SourceFile, SourceSpan } from '@virune/compiler/experimental';
import {
	CodeActionKind,
	TextEdit,
	type CodeAction,
	type Diagnostic,
} from 'vscode-languageserver/node';
import type { AnalysisSnapshot } from '../analysis/project-manager.js';
import { filePathToUri, sourceSpanToRange } from '../analysis/position.js';

export function codeActionsForDiagnostics(
	snapshot: AnalysisSnapshot,
	path: string,
	requestedDiagnostics: readonly Diagnostic[],
): readonly CodeAction[] {
	const source = snapshot.modulesByPath.get(path)?.source;
	if (source === undefined) return [];
	const actions: CodeAction[] = [];
	for (const diagnostic of snapshot.result.diagnostics) {
		if (diagnostic.span.fileId !== source.id) continue;
		const requested = requestedDiagnostics.filter(item => matchesDiagnostic(item, diagnostic));
		if (requested.length === 0) continue;
		for (const fix of diagnostic.fixes ?? []) {
			const editSource = snapshot.sourcesById.get((fix.span ?? diagnostic.span).fileId);
			if (editSource !== undefined) actions.push(toCodeAction(editSource, diagnostic, fix, requested));
		}
	}
	return actions;
}

function matchesDiagnostic(requested: Diagnostic, diagnostic: ViruneDiagnostic): boolean {
	if (String(requested.code ?? '') !== diagnostic.code) return false;
	const range = sourceSpanToRange(diagnostic.span);
	return requested.range.start.line === range.start.line
		&& requested.range.start.character === range.start.character
		&& requested.range.end.line === range.end.line
		&& requested.range.end.character === range.end.character;
}

function toCodeAction(
	source: SourceFile,
	diagnostic: ViruneDiagnostic,
	fix: DiagnosticFix,
	requestedDiagnostics: readonly Diagnostic[],
): CodeAction {
	const span = fix.span ?? diagnostic.span;
	const edit = fixEdit(span, fix);
	return {
		title: fix.title,
		kind: CodeActionKind.QuickFix,
		diagnostics: requestedDiagnostics.filter(item => String(item.code ?? '') === diagnostic.code),
		isPreferred: true,
		edit: {
			changes: {
				[filePathToUri(source.path)]: [edit],
			},
		},
	};
}

function fixEdit(span: SourceSpan, fix: DiagnosticFix): TextEdit {
	const range = sourceSpanToRange(span);
	switch (fix.kind) {
		case 'insert': return TextEdit.insert(range.start, fix.text ?? '');
		case 'replace': return TextEdit.replace(range, fix.text ?? '');
		case 'rewrite': return TextEdit.replace(range, fix.text ?? '');
		case 'remove': return TextEdit.replace(range, '');
	}
}
