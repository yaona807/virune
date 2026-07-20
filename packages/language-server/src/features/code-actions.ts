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

export function documentationCodeActions(
	module: import('@virune/compiler/experimental').BuiltModule,
	source: SourceFile,
	line: number,
): readonly CodeAction[] {
	if (module.ast === undefined) return [];
	const target = documentedTargetOnLine(module.ast, source, line);
	const actions: CodeAction[] = [];
	if (target !== undefined && target.node.documentation === undefined) {
		const lineStart = lineStartOffset(source.text, target.anchorLine);
		const indentation = source.text.slice(lineStart, target.anchor).match(/^\s*/u)?.[0] ?? '';
		actions.push({
			title: 'Generate documentation comment',
			kind: CodeActionKind.RefactorRewrite,
			edit: {
				changes: {
					[filePathToUri(source.path)]: [TextEdit.insert(sourceSpanToRange(offsetSpan(source, lineStart)).start, `${indentation}/// TODO: Describe ${target.name}.\n`)],
				},
			},
		});
	}
	if (module.ast.documentation === undefined && line === 0) {
		actions.push({
			title: 'Generate module documentation',
			kind: CodeActionKind.RefactorRewrite,
			edit: {
				changes: {
					[filePathToUri(source.path)]: [TextEdit.insert({ line: 0, character: 0 }, '//! TODO: Describe this module.\n\n')],
				},
			},
		});
	}
	return actions;
}

interface DocumentedTarget {
	readonly node: { readonly documentation?: import('@virune/compiler/experimental').DocumentationNode };
	readonly name: string;
	readonly anchor: number;
	readonly anchorLine: number;
	readonly declarationLine: number;
}

function documentedTargetOnLine(
	module: import('@virune/compiler/experimental').ModuleNode,
	source: SourceFile,
	line: number,
): DocumentedTarget | undefined {
	const targets: DocumentedTarget[] = [];
	for (const declaration of module.declarations) {
		if (declaration.kind === 'TestDeclaration') continue;
		const declarationName = declaration.kind === 'ExternDeclaration' ? declaration.module : declaration.name;
		const declarationAnchor = declaration.attributes.length === 0
			? declaration.span.start
			: [declaration.span.start, ...declaration.attributes.map(attribute => attribute.span.start)].sort((left, right) => left.offset - right.offset)[0]!;
		targets.push({
			node: declaration,
			name: `\`${declarationName}\``,
			anchor: declarationAnchor.offset,
			anchorLine: declarationAnchor.line - 1,
			declarationLine: declarationNameLine(source, declaration.span, declarationName),
		});
		if (declaration.kind === 'RecordDeclaration') {
			for (const field of declaration.fields) {
				const anchor = field.attributes.length === 0
					? field.span.start
					: [field.span.start, ...field.attributes.map(attribute => attribute.span.start)].sort((left, right) => left.offset - right.offset)[0]!;
				targets.push({ node: field, name: `\`${field.name}\``, anchor: anchor.offset, anchorLine: anchor.line - 1, declarationLine: declarationNameLine(source, field.span, field.name) });
			}
		} else if (declaration.kind === 'EnumDeclaration') {
			for (const variant of declaration.variants) {
				targets.push({ node: variant, name: `\`${variant.name}\``, anchor: variant.span.start.offset, anchorLine: variant.span.start.line - 1, declarationLine: declarationNameLine(source, variant.span, variant.name) });
			}
		} else if (declaration.kind === 'ExternDeclaration') {
			for (const fn of declaration.functions) {
				targets.push({ node: fn, name: `\`${fn.name}\``, anchor: fn.span.start.offset, anchorLine: fn.span.start.line - 1, declarationLine: declarationNameLine(source, fn.span, fn.name) });
			}
		}
	}
	return targets
		.filter(target => target.declarationLine === line)
		.sort((left, right) => right.anchor - left.anchor)[0];
}

function declarationNameLine(source: SourceFile, span: SourceSpan, name: string): number {
	return nameRangeForAction(source, span, name).start.line;
}

function nameRangeForAction(source: SourceFile, span: SourceSpan, name: string): import('vscode-languageserver/node').Range {
	const start = Math.max(0, Math.min(source.text.length, span.start.offset));
	const end = Math.max(start, Math.min(source.text.length, span.end.offset + 1));
	const index = source.text.slice(start, end).indexOf(name);
	const offset = index < 0 ? start : start + index;
	return sourceSpanToRange(offsetSpan(source, offset, name.length));
}

function offsetSpan(source: SourceFile, offset: number, length = 0): SourceSpan {
	const start = offsetPosition(source.text, offset);
	const end = offsetPosition(source.text, offset + length);
	return { fileId: source.id, start, end };
}

function offsetPosition(text: string, targetOffset: number): SourceSpan['start'] {
	const offset = Math.max(0, Math.min(text.length, targetOffset));
	let line = 1;
	let column = 1;
	for (let index = 0; index < offset; index++) {
		if (text.charCodeAt(index) === 10) { line++; column = 1; }
		else column++;
	}
	return { offset, line, column };
}

function lineStartOffset(text: string, line: number): number {
	let currentLine = 0;
	let offset = 0;
	while (currentLine < line) {
		const next = text.indexOf('\n', offset);
		if (next < 0) return text.length;
		offset = next + 1;
		currentLine++;
	}
	return offset;
}
