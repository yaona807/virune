import type { IToken } from 'chevrotain';
import type * as A from '../ast/nodes.js';
import type { DiagnosticBag } from '../diagnostics/diagnostic.js';
import type { SourceFile, SourceSpan } from '../source.js';

interface DocumentationTarget {
	readonly node: A.DocumentedNode;
	readonly anchor: number;
	readonly label: string;
	readonly supported: boolean;
}

interface CommentGroup {
	readonly tokens: readonly IToken[];
	readonly start: number;
	readonly end: number;
	readonly endExclusive: number;
	readonly span: SourceSpan;
}

type MutableDocumentedNode = { documentation?: A.DocumentationNode };

const statementKinds = new Set([
	'LetStatement',
	'ReturnStatement',
	'IfStatement',
	'ForStatement',
	'WhileStatement',
	'BreakStatement',
	'ContinueStatement',
	'DiscardStatement',
	'AssignmentStatement',
	'DeferStatement',
	'ExpressionStatement',
]);

/**
 * Associates documentation comments after parsing so the grammar remains free
 * from comment-specific productions. Invalid placements are reported before
 * semantic analysis and therefore never affect generated JavaScript.
 */
export function attachDocumentation(
	module: A.ModuleNode,
	source: SourceFile,
	comments: readonly IToken[],
	tokens: readonly IToken[],
	diagnostics: DiagnosticBag,
): A.ModuleNode {
	const sortedComments = [...comments].sort((left, right) => left.startOffset - right.startOffset);
	attachModuleDocumentation(module, source, sortedComments, tokens, diagnostics);
	attachDeclarationDocumentation(module, source, sortedComments, diagnostics);
	return module;
}

function attachModuleDocumentation(
	module: A.ModuleNode,
	source: SourceFile,
	comments: readonly IToken[],
	tokens: readonly IToken[],
	diagnostics: DiagnosticBag,
): void {
	const moduleTokens = comments.filter(comment => comment.tokenType.name === 'ModuleDocumentationComment');
	const groups = groupComments(moduleTokens, source.id);
	if (groups.length === 0) return;
	const firstCodeOffset = tokens.find(token => token.tokenType.name !== 'NewLine')?.startOffset ?? source.text.length;
	let attached = false;
	for (const group of groups) {
		if (group.start < firstCodeOffset && attached) {
			diagnostics.error('L0013', 'A module cannot have multiple documentation comment groups', group.span);
			continue;
		}
		if (group.start >= firstCodeOffset || !isWhitespace(source.text.slice(0, group.start))) {
			diagnostics.error('L0011', 'Module documentation comments are allowed only at the start of a file', group.span);
			continue;
		}
		if (attached) {
			diagnostics.error('L0013', 'A module cannot have multiple documentation comment groups', group.span);
			continue;
		}
		(module as MutableDocumentedNode).documentation = documentationNode(group, '//!');
		attached = true;
	}
}

function attachDeclarationDocumentation(
	module: A.ModuleNode,
	source: SourceFile,
	comments: readonly IToken[],
	diagnostics: DiagnosticBag,
): void {
	const documentationTokens = comments.filter(comment => comment.tokenType.name === 'DocumentationComment');
	const groups = groupComments(documentationTokens, source.id);
	if (groups.length === 0) return;
	const targets = collectTargets(module).sort((left, right) => left.anchor - right.anchor || Number(right.supported) - Number(left.supported));

	for (const group of groups) {
		if (!group.tokens.every(token => isFirstNonWhitespaceOnLine(source.text, token.startOffset))) {
			diagnostics.error('L0010', 'Documentation comments must be the first non-whitespace content on their line', group.span);
			continue;
		}
		const direct = firstReachableTarget(group, targets, source, comments, new Set());
		if (direct !== undefined) {
			if (!direct.supported) {
				diagnostics.error('L0012', `Documentation comments cannot be attached to ${direct.label}`, group.span);
				continue;
			}
			const mutable = direct.node as MutableDocumentedNode;
			if (mutable.documentation !== undefined) {
				diagnostics.error('L0013', 'A declaration cannot have multiple documentation comment groups', group.span);
				continue;
			}
			mutable.documentation = documentationNode(group, '///');
			continue;
		}

		const duplicate = firstReachableTarget(group, targets, source, comments, new Set(['DocumentationComment']));
		if (duplicate?.supported === true) {
			diagnostics.error('L0013', 'A declaration cannot have multiple documentation comment groups', group.span);
			continue;
		}
		diagnostics.error('L0010', 'Documentation comment is not attached to a supported declaration', group.span);
	}
}

function collectTargets(module: A.ModuleNode): DocumentationTarget[] {
	const targets: DocumentationTarget[] = [];
	for (const declaration of module.declarations) {
		const anchor = declarationAnchor(declaration);
		if (declaration.kind === 'TestDeclaration') {
			targets.push({ node: {}, anchor, label: 'a test declaration', supported: false });
		} else {
			targets.push({ node: declaration, anchor, label: declarationLabel(declaration), supported: true });
		}
		if (declaration.kind === 'RecordDeclaration') {
			for (const field of declaration.fields) {
				targets.push({ node: field, anchor: memberAnchor(field), label: 'a record field', supported: true });
			}
		} else if (declaration.kind === 'EnumDeclaration') {
			for (const variant of declaration.variants) {
				targets.push({ node: variant, anchor: variant.span.start.offset, label: 'an enum variant', supported: true });
			}
		} else if (declaration.kind === 'ExternDeclaration') {
			for (const fn of declaration.functions) {
				targets.push({ node: fn, anchor: fn.span.start.offset, label: 'an extern function', supported: true });
				for (const parameter of fn.parameters) targets.push({ node: {}, anchor: parameter.span.start.offset, label: 'a function parameter', supported: false });
			}
		} else if (declaration.kind === 'FunctionDeclaration') {
			for (const parameter of declaration.parameters) targets.push({ node: {}, anchor: parameter.span.start.offset, label: 'a function parameter', supported: false });
		}
	}
	for (const declaration of module.imports) {
		targets.push({ node: {}, anchor: declaration.span.start.offset, label: 'an import declaration', supported: false });
		for (const item of declaration.items) targets.push({ node: {}, anchor: item.span.start.offset, label: 'an import item', supported: false });
	}
	collectUnsupportedAstTargets(module, targets);
	return targets;
}

function collectUnsupportedAstTargets(module: A.ModuleNode, targets: DocumentationTarget[]): void {
	const visit = (value: unknown): void => {
		if (Array.isArray(value)) {
			for (const item of value) visit(item);
			return;
		}
		if (value === null || typeof value !== 'object') return;
		const object = value as Record<string, unknown>;
		const kind = object.kind;
		const span = object.span;
		if (typeof kind === 'string' && statementKinds.has(kind) && isSourceSpan(span)) {
			targets.push({ node: {}, anchor: span.start.offset, label: 'a statement', supported: false });
		}
		for (const [key, child] of Object.entries(object)) {
			if (key === 'span' || key === 'documentation' || key === 'symbolId' || key === 'inferredTypeId' || key === 'resolvedTypeId') continue;
			visit(child);
		}
	};
	visit(module);
}

function firstReachableTarget(
	group: CommentGroup,
	targets: readonly DocumentationTarget[],
	source: SourceFile,
	comments: readonly IToken[],
	allowedCommentTypes: ReadonlySet<string>,
): DocumentationTarget | undefined {
	for (const target of targets) {
		if (target.anchor <= group.end) continue;
		if (onlyTriviaBetween(source.text, group.endExclusive, target.anchor, comments, allowedCommentTypes)) return target;
		const firstNonWhitespace = firstNonWhitespaceOffset(source.text, group.endExclusive, target.anchor);
		if (firstNonWhitespace !== undefined && firstNonWhitespace < target.anchor) {
			const commentAtOffset = comments.some(comment => comment.startOffset === firstNonWhitespace && allowedCommentTypes.has(comment.tokenType.name));
			if (!commentAtOffset) return undefined;
		}
	}
	return undefined;
}

function onlyTriviaBetween(
	text: string,
	start: number,
	end: number,
	comments: readonly IToken[],
	allowedCommentTypes: ReadonlySet<string>,
): boolean {
	let cursor = start;
	for (const comment of comments) {
		const commentEnd = (comment.endOffset ?? comment.startOffset) + 1;
		if (commentEnd <= start || comment.startOffset >= end) continue;
		if (!isWhitespace(text.slice(cursor, comment.startOffset))) return false;
		if (!allowedCommentTypes.has(comment.tokenType.name)) return false;
		cursor = Math.max(cursor, commentEnd);
	}
	return isWhitespace(text.slice(cursor, end));
}

function firstNonWhitespaceOffset(text: string, start: number, end: number): number | undefined {
	for (let offset = start; offset < end; offset++) if (!/\s/u.test(text[offset] ?? '')) return offset;
	return undefined;
}

function groupComments(comments: readonly IToken[], fileId: number): CommentGroup[] {
	const sorted = [...comments].sort((left, right) => left.startOffset - right.startOffset);
	const groups: IToken[][] = [];
	for (const comment of sorted) {
		const current = groups.at(-1);
		const previous = current?.at(-1);
		if (current !== undefined && previous !== undefined && (comment.startLine ?? 1) === (previous.endLine ?? previous.startLine ?? 1) + 1) current.push(comment);
		else groups.push([comment]);
	}
	return groups.map(tokens => {
		const first = tokens[0]!;
		const last = tokens.at(-1)!;
		const end = last.endOffset ?? last.startOffset;
		return {
			tokens,
			start: first.startOffset,
			end,
			endExclusive: end + 1,
			span: tokensSpan(fileId, first, last),
		};
	});
}

function documentationNode(group: CommentGroup, marker: '///' | '//!'): A.DocumentationNode {
	const lines = group.tokens.map(token => normalizeDocumentationLine(token.image, marker));
	while (lines[0] === '') lines.shift();
	while (lines.at(-1) === '') lines.pop();
	return { kind: 'Documentation', text: lines.join('\n'), span: group.span };
}

function normalizeDocumentationLine(image: string, marker: '///' | '//!'): string {
	const body = image.slice(marker.length);
	return body.startsWith(' ') ? body.slice(1) : body;
}

function declarationAnchor(declaration: A.Declaration): number {
	const attributes = 'attributes' in declaration ? declaration.attributes : [];
	return Math.min(declaration.span.start.offset, ...attributes.map(attribute => attribute.span.start.offset));
}

function memberAnchor(field: A.RecordFieldNode): number {
	return Math.min(field.span.start.offset, ...field.attributes.map(attribute => attribute.span.start.offset));
}

function declarationLabel(declaration: Exclude<A.Declaration, A.TestDeclaration>): string {
	switch (declaration.kind) {
		case 'FunctionDeclaration': return 'a function declaration';
		case 'RecordDeclaration': return 'a record declaration';
		case 'EnumDeclaration': return 'an enum declaration';
		case 'NewtypeDeclaration': return 'a newtype declaration';
		case 'TypeAliasDeclaration': return 'a type alias declaration';
		case 'ExternDeclaration': return 'an extern declaration';
		case 'TopLevelLetDeclaration': return 'a top-level binding';
	}
}

function tokensSpan(fileId: number, first: IToken, last: IToken): SourceSpan {
	return {
		fileId,
		start: { offset: first.startOffset, line: first.startLine ?? 1, column: first.startColumn ?? 1 },
		end: {
			offset: (last.endOffset ?? last.startOffset) + 1,
			line: last.endLine ?? last.startLine ?? 1,
			column: (last.endColumn ?? last.startColumn ?? 1) + 1,
		},
	};
}

function isFirstNonWhitespaceOnLine(text: string, offset: number): boolean {
	const lineStart = text.lastIndexOf('\n', Math.max(0, offset - 1)) + 1;
	return isWhitespace(text.slice(lineStart, offset));
}

function isWhitespace(value: string): boolean {
	return /^\s*$/u.test(value);
}

function isSourceSpan(value: unknown): value is SourceSpan {
	if (value === null || typeof value !== 'object') return false;
	const span = value as Partial<SourceSpan>;
	return typeof span.fileId === 'number' && span.start !== undefined && typeof span.start.offset === 'number';
}
