import type { AstNode, ModuleNode, SourceFile, SourceSpan } from '@virune/compiler/experimental';
import { positionToOffset, spanContainsOffset, spanLength } from './position.js';

export interface SpannedValue {
	readonly span: SourceSpan;
}

export function isAstNode(value: unknown): value is AstNode {
	return isObject(value) && typeof value.kind === 'string' && isSourceSpan(value.span);
}

export function findNodePathAtOffset(module: ModuleNode, source: SourceFile, offset: number): readonly AstNode[] {
	const nodes: AstNode[] = [];
	walkAst(module, node => {
		if (node.span.fileId === source.id && spanContainsOffset(source, node.span, offset)) nodes.push(node);
	});
	return nodes.sort((left, right) => spanLength(source, right.span) - spanLength(source, left.span));
}

export function walkAst(module: ModuleNode, visitor: (node: AstNode) => void): void {
	const visit = (value: unknown): void => {
		if (Array.isArray(value)) {
			for (const item of value) visit(item);
			return;
		}
		if (!isObject(value) || isSourceSpan(value)) return;
		if (isAstNode(value)) visitor(value);
		for (const [key, child] of Object.entries(value)) {
			if (key === 'span' || key === 'documentation' || key === 'symbolId' || key === 'inferredTypeId' || key === 'resolvedTypeId') continue;
			visit(child);
		}
	};
	visit(module);
}

export function findSmallestNode<T extends AstNode>(
	module: ModuleNode,
	source: SourceFile,
	offset: number,
	predicate: (node: AstNode) => node is T,
): T | undefined {
	let result: T | undefined;
	walkAst(module, node => {
		if (node.span.fileId !== source.id || !predicate(node) || !spanContainsOffset(source, node.span, offset)) return;
		if (result === undefined || spanLength(source, node.span) <= spanLength(source, result.span)) result = node;
	});
	return result;
}

function isObject(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object';
}

function isSourceSpan(value: unknown): value is SourceSpan {
	if (!isObject(value)) return false;
	return typeof value.fileId === 'number' && isPosition(value.start) && isPosition(value.end);
}

function isPosition(value: unknown): boolean {
	return isObject(value) && typeof value.offset === 'number' && typeof value.line === 'number' && typeof value.column === 'number';
}
