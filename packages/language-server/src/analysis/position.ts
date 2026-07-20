import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { SourceFile, SourcePosition, SourceSpan } from '@virune/compiler/experimental';
import type { Position, Range } from 'vscode-languageserver/node';

export function uriToFilePath(uri: string): string | undefined {
	try {
		const value = new URL(uri);
		return value.protocol === 'file:' ? resolve(fileURLToPath(value)) : undefined;
	} catch {
		return undefined;
	}
}

export function filePathToUri(path: string): string {
	return pathToFileURL(path).href;
}

export function sourcePositionToPosition(position: SourcePosition): Position {
	return {
		line: Math.max(0, position.line - 1),
		character: Math.max(0, position.column - 1),
	};
}

export function sourceSpanToRange(span: SourceSpan): Range {
	return {
		start: sourcePositionToPosition(span.start),
		end: sourcePositionToPosition(span.end),
	};
}

export function positionToOffset(source: SourceFile, position: Position): number {
	const targetLine = Math.max(0, position.line);
	let line = 0;
	let offset = 0;
	while (line < targetLine && offset < source.text.length) {
		const next = source.text.indexOf('\n', offset);
		if (next < 0) return source.text.length;
		offset = next + 1;
		line++;
	}
	return Math.min(source.text.length, offset + Math.max(0, position.character));
}

export function offsetToPosition(source: SourceFile, targetOffset: number): Position {
	const offset = Math.max(0, Math.min(source.text.length, targetOffset));
	let line = 0;
	let lineStart = 0;
	for (let index = 0; index < offset; index++) {
		if (source.text.charCodeAt(index) === 10) {
			line++;
			lineStart = index + 1;
		}
	}
	return { line, character: offset - lineStart };
}

export function fullDocumentRange(source: SourceFile): Range {
	return { start: { line: 0, character: 0 }, end: offsetToPosition(source, source.text.length) };
}

export function nameRange(source: SourceFile, span: SourceSpan, name: string): Range {
	const start = positionToOffset(source, sourcePositionToPosition(span.start));
	const end = positionToOffset(source, sourcePositionToPosition(span.end));
	const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
	const identifier = /^[A-Za-z_][A-Za-z0-9_]*$/u.test(name);
	const pattern = new RegExp(identifier ? `\\b${escaped}\\b` : escaped, 'u');
	const spanText = source.text.slice(start, Math.max(start, end));
	const spanMatch = pattern.exec(spanText);
	if (spanMatch !== null) return rangeFromOffsets(source, start + spanMatch.index, start + spanMatch.index + name.length);

	const lineStart = source.text.lastIndexOf('\n', Math.max(0, start - 1)) + 1;
	const nextNewLine = source.text.indexOf('\n', start);
	const lineEnd = nextNewLine < 0 ? source.text.length : nextNewLine;
	const lineText = source.text.slice(lineStart, lineEnd);
	const lineMatch = pattern.exec(lineText);
	if (lineMatch !== null) return rangeFromOffsets(source, lineStart + lineMatch.index, lineStart + lineMatch.index + name.length);

	const declarationMatch = /\b(?:fn|record|enum|newtype|type|let|const)\s+(?:mut\s+)?([A-Za-z_][A-Za-z0-9_]*)/u.exec(lineText);
	if (declarationMatch?.[1] !== undefined) {
		const index = lineText.indexOf(declarationMatch[1], declarationMatch.index);
		return rangeFromOffsets(source, lineStart + index, lineStart + index + declarationMatch[1].length);
	}

	const matches = [...source.text.matchAll(new RegExp(identifier ? `\\b${escaped}\\b` : escaped, 'gu'))];
	const nearest = matches.sort((left, right) => {
		const leftIndex = left.index ?? 0;
		const rightIndex = right.index ?? 0;
		return Math.abs(leftIndex - span.start.offset) - Math.abs(rightIndex - span.start.offset);
	})[0];
	if (nearest?.index !== undefined) return rangeFromOffsets(source, nearest.index, nearest.index + name.length);
	return rangeFromOffsets(source, start, Math.min(source.text.length, start + Math.max(1, name.length)));
}

function rangeFromOffsets(source: SourceFile, start: number, end: number): Range {
	return { start: offsetToPosition(source, start), end: offsetToPosition(source, end) };
}

export function spanContainsOffset(source: SourceFile, span: SourceSpan, offset: number): boolean {
	const start = positionToOffset(source, sourcePositionToPosition(span.start));
	const end = positionToOffset(source, sourcePositionToPosition(span.end));
	return offset >= start && offset <= Math.max(start, end);
}

export function spanLength(source: SourceFile, span: SourceSpan): number {
	const start = positionToOffset(source, sourcePositionToPosition(span.start));
	const end = positionToOffset(source, sourcePositionToPosition(span.end));
	return Math.max(0, end - start);
}
