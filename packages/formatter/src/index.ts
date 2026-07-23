import type { SourceFile } from '@virune/compiler';
import { lex, parseSource, type AttributeNode, type BlockStatement, type Declaration, type Expression, type ImportDeclaration, type MatchArmNode, type ModuleNode, type Pattern, type RecordEntryNode, type Statement, type TypeReferenceNode } from '@virune/compiler/experimental';

export interface FormatResult { readonly text: string; readonly changed: boolean; readonly errors: readonly string[]; }

interface TokenLike {
	readonly image: string;
	readonly startOffset: number;
	readonly endOffset?: number;
	readonly startLine?: number;
	readonly endLine?: number;
	readonly tokenType: { readonly name: string };
}

interface CommentLike extends TokenLike {}

interface CommentPlacement {
	readonly offset: number;
	readonly text: string;
	readonly trailing: boolean;
	readonly previous?: number;
	readonly next?: number;
}

interface TextEdit {
	readonly start: number;
	readonly end: number;
	readonly text: string;
	readonly order: number;
}

class Printer {
	readonly #lines: string[] = [];
	#indent = 0;
	public line(text = ''): void { for (const part of text.split('\n')) this.#lines.push(`${'\t'.repeat(this.#indent)}${part}`); }
	public blank(): void { if (this.#lines.length > 0 && this.#lines.at(-1) !== '') this.#lines.push(''); }
	public indent(action: () => void): void { this.#indent++; action(); this.#indent--; }
	public commentsBefore(_offset: number): void {}
	public remainingComments(): void {}
	public result(): string { return `${this.#lines.join('\n').replace(/\n{3,}/gu, '\n\n').replace(/\s+$/u, '')}\n`; }
}

export function formatSource(source: string): FormatResult {
	const sourceFile: SourceFile = { id: 1, path: '<format>.virune', text: source };
	const parsed = parseSource(sourceFile);
	if (parsed.ast === undefined || parsed.diagnostics.some(item => item.severity === 'error')) return { text: source, changed: false, errors: parsed.diagnostics.map(item => `${item.code}: ${item.message}`) };
	const printer = new Printer();
	printModule(printer, parsed.ast);
	const base = printer.result();
	const comments = lex(source).comments as readonly CommentLike[];
	const text = comments.length === 0 ? base : restoreComments(source, base, comments);
	return { text, changed: text !== (source.endsWith('\n') ? source : `${source}\n`), errors: [] };
}

function restoreComments(source: string, formatted: string, comments: readonly CommentLike[]): string {
	const originalTokens = significantTokens(lex(source).tokens as readonly TokenLike[]);
	const formattedTokens = significantTokens(lex(formatted).tokens as readonly TokenLike[]);
	const mapping = alignTokens(originalTokens, formattedTokens);
	const placements = comments.map(comment => locateComment(source, comment, originalTokens, mapping));
	const edits = placements.map((placement, index) => placementToEdit(placement, formatted, formattedTokens, index));
	const grouped = groupEdits(edits);
	let output = formatted;
	for (const edit of grouped.sort((left, right) => right.start - left.start || right.end - left.end)) output = `${output.slice(0, edit.start)}${edit.text}${output.slice(edit.end)}`;
	return `${output.replace(/[ \t]+\n/gu, '\n').replace(/\n{3,}/gu, '\n\n').replace(/\s+$/u, '')}\n`;
}

function significantTokens(tokens: readonly TokenLike[]): readonly TokenLike[] {
	return tokens.filter(token => token.tokenType.name !== 'NewLine');
}

function locateComment(
	source: string,
	comment: CommentLike,
	tokens: readonly TokenLike[],
	mapping: ReadonlyMap<number, number>,
): CommentPlacement {
	let previousOriginal: number | undefined;
	let nextOriginal: number | undefined;
	for (let index = 0; index < tokens.length; index++) {
		const token = tokens[index]!;
		if ((token.endOffset ?? token.startOffset) < comment.startOffset) previousOriginal = index;
		else if (token.startOffset > (comment.endOffset ?? comment.startOffset)) { nextOriginal = index; break; }
	}
	const previous = nearestMapped(mapping, previousOriginal, -1, tokens.length);
	const next = nearestMapped(mapping, nextOriginal, 1, tokens.length);
	const lineStart = source.lastIndexOf('\n', Math.max(0, comment.startOffset - 1)) + 1;
	const prefix = source.slice(lineStart, comment.startOffset);
	const previousToken = previousOriginal === undefined ? undefined : tokens[previousOriginal];
	const trailing = /\S/u.test(prefix) && previousToken?.endLine === comment.startLine;
	return { offset: comment.startOffset, text: normalizeCommentText(comment), trailing, ...(previous === undefined ? {} : { previous }), ...(next === undefined ? {} : { next }) };
}

function normalizeCommentText(comment: CommentLike): string {
	const marker = comment.tokenType.name === 'DocumentationComment'
		? '///'
		: comment.tokenType.name === 'ModuleDocumentationComment'
			? '//!'
			: undefined;
	if (marker === undefined) return comment.image;
	const body = comment.image.slice(marker.length);
	if (body.trim().length === 0) return marker;
	return body.startsWith(' ') ? comment.image : `${marker} ${body}`;
}

function nearestMapped(
	mapping: ReadonlyMap<number, number>,
	origin: number | undefined,
	direction: -1 | 1,
	length: number,
): number | undefined {
	if (origin === undefined) return undefined;
	for (let index = origin; index >= 0 && index < length; index += direction) {
		const mapped = mapping.get(index);
		if (mapped !== undefined) return mapped;
	}
	return undefined;
}

function placementToEdit(
	placement: CommentPlacement,
	formatted: string,
	tokens: readonly TokenLike[],
	order: number,
): TextEdit {
	if (placement.trailing && placement.previous !== undefined) {
		const previous = tokens[placement.previous]!;
		const start = (previous.endOffset ?? previous.startOffset) + 1;
		const next = placement.next === undefined ? undefined : tokens[placement.next];
		const indent = placement.next === undefined ? '' : indentationForToken(tokens, placement.next);
		const separator = next === undefined ? '' : `\n${indent}`;
		return { start, end: start, text: ` ${placement.text}${separator}`, order };
	}
	if (placement.next !== undefined) {
		const next = tokens[placement.next]!;
		const tokenStart = next.startOffset;
		let start = tokenStart;
		while (start > 0 && (formatted[start - 1] === ' ' || formatted[start - 1] === '\t')) start--;
		const indent = indentationForToken(tokens, placement.next);
		const beforeHasCode = /\S/u.test(formatted.slice(formatted.lastIndexOf('\n', Math.max(0, start - 1)) + 1, start));
		const prefix = start === 0 ? '' : beforeHasCode || formatted[start - 1] !== '\n' ? '\n' : '';
		return { start, end: tokenStart, text: `${prefix}${indent}${placement.text}\n${indent}`, order };
	}
	const start = formatted.length;
	const prefix = formatted.endsWith('\n') ? '' : '\n';
	return { start, end: start, text: `${prefix}${placement.text}\n`, order };
}

function indentationForToken(tokens: readonly TokenLike[], tokenIndex: number): string {
	let depth = 0;
	for (let index = 0; index < tokenIndex; index++) {
		const name = tokens[index]!.tokenType.name;
		if (['LBrace', 'LBracket', 'LParen'].includes(name)) depth++;
		else if (['RBrace', 'RBracket', 'RParen'].includes(name)) depth = Math.max(0, depth - 1);
	}
	if (['RBrace', 'RBracket', 'RParen'].includes(tokens[tokenIndex]!.tokenType.name)) depth = Math.max(0, depth - 1);
	return '\t'.repeat(depth);
}

function groupEdits(edits: readonly TextEdit[]): TextEdit[] {
	const groups = new Map<string, TextEdit[]>();
	for (const edit of edits) {
		const key = `${edit.start}:${edit.end}`;
		const group = groups.get(key) ?? [];
		group.push(edit);
		groups.set(key, group);
	}
	return [...groups.values()].map(group => {
		const ordered = [...group].sort((left, right) => left.order - right.order);
		if (ordered.length === 1) return ordered[0]!;
		const first = ordered[0]!;
		const text = ordered.slice(1).reduce((merged, item) => mergeEditText(merged, item.text), first.text);
		return { start: first.start, end: first.end, text, order: first.order };
	});
}

function mergeEditText(merged: string, text: string): string {
	if (text.startsWith('\n')) return `${merged}${text.replace(/^\n[ \t]*/u, '')}`;
	const trailingIndent = /(?:^|\n)([ \t]+)$/u.exec(merged)?.[1];
	if (trailingIndent !== undefined && text.startsWith(trailingIndent)) return `${merged}${text.slice(trailingIndent.length)}`;
	return `${merged}${text.startsWith(' ') ? text.slice(1) : text}`;
}

function alignTokens(original: readonly TokenLike[], formatted: readonly TokenLike[]): ReadonlyMap<number, number> {
	const cells = (original.length + 1) * (formatted.length + 1);
	if (cells > 4_000_000) return alignTokensGreedy(original, formatted);
	const width = formatted.length + 1;
	const scores = new Uint16Array(cells);
	for (let left = original.length - 1; left >= 0; left--) {
		for (let right = formatted.length - 1; right >= 0; right--) {
			const index = left * width + right;
			scores[index] = tokenMatches(original[left]!, formatted[right]!)
				? scores[(left + 1) * width + right + 1]! + 1
				: Math.max(scores[(left + 1) * width + right]!, scores[left * width + right + 1]!);
		}
	}
	const mapping = new Map<number, number>();
	let left = 0;
	let right = 0;
	while (left < original.length && right < formatted.length) {
		if (tokenMatches(original[left]!, formatted[right]!)) { mapping.set(left++, right++); continue; }
		if (scores[(left + 1) * width + right]! >= scores[left * width + right + 1]!) left++;
		else right++;
	}
	return mapping;
}

function alignTokensGreedy(original: readonly TokenLike[], formatted: readonly TokenLike[]): ReadonlyMap<number, number> {
	const mapping = new Map<number, number>();
	let right = 0;
	for (let left = 0; left < original.length; left++) {
		for (; right < formatted.length; right++) {
			if (!tokenMatches(original[left]!, formatted[right]!)) continue;
			mapping.set(left, right++);
			break;
		}
	}
	return mapping;
}

function tokenMatches(left: TokenLike, right: TokenLike): boolean {
	if (left.tokenType.name !== right.tokenType.name) return false;
	if (['StringLiteral', 'IntLiteral', 'FloatLiteral', 'BigIntLiteral'].includes(left.tokenType.name)) return true;
	return left.image === right.image;
}

function printModule(printer: Printer, module: ModuleNode): void {
	if (module.unsafe) { printer.line('unsafe module'); printer.blank(); }
	module.imports.forEach((declaration, index) => { printer.commentsBefore(declaration.span.start.offset); printImport(printer, declaration); if (index === module.imports.length - 1) printer.blank(); });
	module.declarations.forEach((declaration, index) => { printer.commentsBefore(declaration.span.start.offset); printDeclaration(printer, declaration); if (index < module.declarations.length - 1) printer.blank(); });
	printer.remainingComments();
}

function printImport(printer: Printer, declaration: ImportDeclaration): void {
	const prefix = `${declaration.public ? 'pub ' : ''}import${declaration.sourceKind === 'javascript' ? ' js' : ''}${declaration.typeOnly ? ' type' : ''}`;
	if (declaration.defaultImport !== undefined) { printer.line(`${prefix} ${declaration.defaultImport} from ${quote(declaration.source)}`); return; }
	if (declaration.namespaceImport !== undefined) { printer.line(`${prefix} * as ${declaration.namespaceImport} from ${quote(declaration.source)}`); return; }
	if (declaration.items.length === 0) { printer.line(`${prefix} ${quote(declaration.source)}`); return; }
	const items = declaration.items.map(item => item.imported === item.local ? item.imported : `${item.imported} as ${item.local}`).join(', ');
	printer.line(`${prefix} { ${items} } from ${quote(declaration.source)}`);
}

function printAttributes(printer: Printer, attributes: readonly AttributeNode[]): void {
	for (const attribute of attributes) printer.line(`@${attribute.name}${attribute.arguments.length === 0 ? '' : `(${attribute.arguments.map(expression => printExpression(expression)).join(', ')})`}`);
}

function printDeclaration(printer: Printer, declaration: Declaration): void {
	printAttributes(printer, declaration.attributes);
	switch (declaration.kind) {
		case 'FunctionDeclaration': {
			const prefix = `${declaration.public ? 'pub ' : ''}${declaration.async ? 'async ' : ''}fn ${declaration.name}${printTypeParameters(declaration.typeParameters.map(item => item.name))}`;
			const parameters = declaration.parameters.map(parameter => `${parameter.name}${parameter.optional ? '?' : ''}: ${printType(parameter.type)}`);
			const signature = `${prefix}${printDelimited(parameters, '(', ')')} ${declaration.returnType === undefined ? '' : `-> ${printType(declaration.returnType)} `}${printUses(declaration.effects)}`.trimEnd();
			if (declaration.expressionBody) printer.line(`${signature} => ${printExpression(declaration.body as Expression)}`);
			else { printer.line(`${signature} {`); printer.indent(() => printBlockContents(printer, declaration.body as BlockStatement)); printer.line('}'); }
			break;
		}
		case 'RecordDeclaration':
			printer.line(`${declaration.public ? 'pub ' : ''}record ${declaration.name}${printTypeParameters(declaration.typeParameters.map(item => item.name))}${printDerives(declaration.derives)} {`);
			printer.indent(() => declaration.fields.forEach(field => { printer.commentsBefore(field.span.start.offset); printAttributes(printer, field.attributes); printer.line(`${field.name}: ${printType(field.type)}`); })); printer.line('}'); break;
		case 'EnumDeclaration':
			printer.line(`${declaration.public ? 'pub ' : ''}enum ${declaration.name}${printTypeParameters(declaration.typeParameters.map(item => item.name))}${printDerives(declaration.derives)} {`);
			printer.indent(() => declaration.variants.forEach(variant => { printer.commentsBefore(variant.span.start.offset); printer.line(`${variant.name}${variant.values.length === 0 ? '' : `(${variant.values.map(printType).join(', ')})`}`); })); printer.line('}'); break;
		case 'NewtypeDeclaration': printer.line(`${declaration.public ? 'pub ' : ''}newtype ${declaration.name} = ${printType(declaration.underlying)}`); break;
		case 'TypeAliasDeclaration': printer.line(`${declaration.public ? 'pub ' : ''}type ${declaration.name}${printTypeParameters(declaration.typeParameters.map(item => item.name))} = ${printType(declaration.target)}`); break;
		case 'ExternDeclaration':
			printer.line(`${declaration.unsafe ? 'unsafe ' : ''}extern js ${quote(declaration.module)} {`);
			printer.indent(() => declaration.functions.forEach(fn => printer.line(`${fn.async ? 'async ' : ''}fn ${fn.name}${printDelimited(fn.parameters.map(parameter => `${parameter.name}${parameter.optional ? '?' : ''}: ${printType(parameter.type)}`), '(', ')')} -> ${printType(fn.returnType)}${fn.effects.length === 0 ? '' : ` uses ${fn.effects.join(', ')}`} = ${quote(fn.jsName)}`)));
			printer.line('}'); break;
		case 'TestDeclaration':
			printer.line(`${declaration.async ? 'async ' : ''}test ${quote(declaration.name)} {`); printer.indent(() => printBlockContents(printer, declaration.body)); printer.line('}'); break;
		case 'TopLevelLetDeclaration': printer.line(`${declaration.public ? 'pub ' : ''}${declaration.constant ? 'const' : 'let'} ${declaration.name}${declaration.annotation === undefined ? '' : `: ${printType(declaration.annotation)}`} = ${printExpression(declaration.value)}`); break;
	}
}

function printBlockContents(printer: Printer, block: BlockStatement): void {
	for (const statement of block.statements) { printer.commentsBefore(statement.span.start.offset); printStatement(printer, statement); }
}

function printStatement(printer: Printer, statement: Statement): void {
	switch (statement.kind) {
		case 'LetStatement': printer.line(`let ${statement.mutable ? 'mut ' : ''}${statement.name}${statement.annotation === undefined ? '' : `: ${printType(statement.annotation)}`} = ${printExpression(statement.value)}`); break;
		case 'ReturnStatement': printer.line(statement.value === undefined ? 'return' : `return ${printExpression(statement.value)}`); break;
		case 'IfStatement': printIf(printer, statement); break;
		case 'ForStatement': printer.line(`for ${statement.name} in ${printExpression(statement.iterable)} {`); printer.indent(() => printBlockContents(printer, statement.body)); printer.line('}'); break;
		case 'WhileStatement': printer.line(`while ${printExpression(statement.condition)} {`); printer.indent(() => printBlockContents(printer, statement.body)); printer.line('}'); break;
		case 'BreakStatement': printer.line('break'); break;
		case 'ContinueStatement': printer.line('continue'); break;
		case 'DiscardStatement': printer.line(`discard ${printExpression(statement.expression)}`); break;
		case 'AssignmentStatement': printer.line(`${statement.name} = ${printExpression(statement.value)}`); break;
		case 'ExpressionStatement': printer.line(printExpression(statement.expression)); break;
		case 'DeferStatement': printer.line(`defer ${printExpression(statement.expression)}`); break;
	}
}

function printIf(printer: Printer, statement: Extract<Statement, { kind: 'IfStatement' }>): void {
	printer.line(`if ${printExpression(statement.condition)} {`); printer.indent(() => printBlockContents(printer, statement.thenBlock));
	if (statement.elseBranch === undefined) printer.line('}');
	else if (statement.elseBranch.kind === 'BlockStatement') { printer.line('} else {'); printer.indent(() => printBlockContents(printer, statement.elseBranch as BlockStatement)); printer.line('}'); }
	else { printer.line('} else {'); printer.indent(() => printIf(printer, statement.elseBranch as Extract<Statement, { kind: 'IfStatement' }>)); printer.line('}'); }
}

function printExpression(expression: Expression, parentPrecedence = 0): string {
	const [text, precedence] = expressionText(expression);
	return precedence < parentPrecedence ? `(${text})` : text;
}

function expressionText(expression: Expression): readonly [string, number] {
	switch (expression.kind) {
		case 'LiteralExpression': return [expression.literalKind === 'String' ? quote(expression.value as string) : expression.literalKind === 'BigInt' ? `${expression.value}n` : String(expression.value), 100];
		case 'IdentifierExpression': return [expression.name, 100];
		case 'WildcardExpression': return ['_', 100];
		case 'CallExpression': return [`${printExpression(expression.callee, 90)}${expression.typeArguments.length === 0 ? '' : `<${expression.typeArguments.map(printType).join(', ')}>`}${printDelimited(expression.arguments.map(item => printExpression(item)), '(', ')')}`, 90];
		case 'FieldExpression': return [`${printExpression(expression.target, 90)}.${expression.field}`, 90];
		case 'TryExpression': return expression.operand.kind === 'AwaitExpression' ? [`await ${printExpression(expression.operand.operand, 80)}?`, 80] : [`${printExpression(expression.operand, 90)}?`, 90];
		case 'AwaitExpression': return [`await ${printExpression(expression.operand, 80)}`, 80];
		case 'UnaryExpression': return [`${expression.operator}${printExpression(expression.operand, 80)}`, 80];
		case 'BinaryExpression': { const precedence = binaryPrecedence(expression.operator); return [`${printExpression(expression.left, precedence)} ${expression.operator} ${printExpression(expression.right, precedence + 1)}`, precedence]; }
		case 'PipelineExpression': return [`${printExpression(expression.left, 10)} |> ${printExpression(expression.right, 11)}`, 10];
		case 'RecordExpression': return [printRecordEntries(expression.name, expression.entries), 100];
		case 'RecordUpdateExpression': return [`${printExpression(expression.base, 90)} with ${printRecordEntries('', expression.entries).trimStart()}`, 90];
		case 'ListExpression': return [`[${expression.items.map(item => printExpression(item)).join(', ')}]`, 100];
		case 'TupleExpression': return [`(${expression.items.map(item => printExpression(item)).join(', ')})`, 100];
		case 'ConditionalExpression': return [`if ${printExpression(expression.condition)} then ${printExpression(expression.thenExpression)} else ${printExpression(expression.elseExpression)}`, 5];
		case 'MatchExpression': return [printMatch(expression.target, expression.arms), 5];
		case 'LambdaExpression': {
			const signature = `${expression.async ? 'async ' : ''}fn${printDelimited(expression.parameters.map(parameter => `${parameter.name}${parameter.annotation === undefined ? '' : `: ${printType(parameter.annotation)}`}`), '(', ')')}${expression.returnType === undefined ? '' : ` -> ${printType(expression.returnType)}`}${expression.effects.length === 0 ? '' : ` uses ${expression.effects.join(', ')}`}`;
			if (expression.expressionBody) return [`${signature} => ${printExpression(expression.body as Expression)}`, 5];
			return [`${signature} {\n${printBlockExpression(expression.body as BlockStatement)}\n}`, 5];
		}
		case 'ParallelExpression': return [printParallel(expression.tryMode, expression.entries), 5];
	}
}

function printRecordEntries(name: string, entries: readonly RecordEntryNode[]): string {
	if (entries.length === 0) return `${name}${name.length > 0 ? ' ' : ''}{}`;
	return `${name}${name.length > 0 ? ' ' : ''}{\n${entries.map(entry => `\t${entry.name}: ${printExpression(entry.value)},`).join('\n')}\n}`;
}
function printMatch(target: Expression, arms: readonly MatchArmNode[]): string { return `match ${printExpression(target)} {\n${arms.map(arm => `\t${printPattern(arm.pattern)}${arm.guard === undefined ? '' : ` if ${printExpression(arm.guard)}`} => ${printExpression(arm.expression)}`).join('\n')}\n}`; }
function printParallel(tryMode: boolean, entries: readonly { readonly name: string; readonly value: Expression }[]): string { return `parallel${tryMode ? ' try' : ''} {\n${entries.map(entry => `\t${entry.name}: ${printExpression(entry.value)},`).join('\n')}\n}`; }
function printBlockExpression(block: BlockStatement): string {
	const printer = new Printer();
	printer.indent(() => printBlockContents(printer, block));
	return printer.result().trimEnd();
}

function printPattern(pattern: Pattern): string {
	switch (pattern.kind) {
		case 'WildcardPattern': return '_';
		case 'BindingPattern': return pattern.name;
		case 'LiteralPattern': return pattern.literalKind === 'String' ? quote(pattern.value as string) : String(pattern.value);
		case 'VariantPattern': return `${pattern.name}${pattern.values.length === 0 ? '' : `(${pattern.values.map(printPattern).join(', ')})`}`;
		case 'RecordPattern': {
			const fields = pattern.fields.map(field => `${field.name}: ${printPattern(field.pattern)}`);
			if (pattern.rest) fields.push('...');
			return `${pattern.name} { ${fields.join(', ')} }`;
		}
		case 'OrPattern': return pattern.alternatives.map(printPattern).join(' | ');
		case 'ListPattern': {
			const items = pattern.items.map(printPattern);
			if (pattern.rest !== undefined) items.push(`...${printPattern(pattern.rest)}`);
			return `[${items.join(', ')}]`;
		}
		case 'TuplePattern': return `(${pattern.items.map(printPattern).join(', ')})`;
		case 'RangePattern': return `${pattern.start}..=${pattern.end}`;
	}
}

function printType(type: TypeReferenceNode): string {
	if (type.functionType !== undefined) {
		const value = type.functionType;
		return `${value.async ? 'async ' : ''}fn(${value.parameters.map(printType).join(', ')}) -> ${printType(value.result)}${value.effects.length === 0 ? '' : ` uses ${value.effects.join(', ')}`}${type.optional ? '?' : ''}`;
	}
	if (type.name === '$Tuple') return `(${type.arguments.map(printType).join(', ')})${type.optional ? '?' : ''}`;
	return `${type.name}${type.arguments.length === 0 ? '' : `<${type.arguments.map(printType).join(', ')}>`}${type.optional ? '?' : ''}`;
}
function printTypeParameters(names: readonly string[]): string { return names.length === 0 ? '' : `<${names.join(', ')}>`; }
function printDerives(derives: readonly string[]): string { return derives.length === 0 ? '' : ` derives ${derives.join(', ')}`; }
function printUses(effects: readonly string[]): string { return effects.length === 0 ? '' : `uses ${effects.join(', ')}`; }
function printDelimited(values: readonly string[], open: string, close: string): string { return `${open}${values.join(', ')}${close}`; }
function binaryPrecedence(operator: string): number { if (operator === '||') return 20; if (operator === '&&') return 30; if (['==', '!='].includes(operator)) return 40; if (['<', '<=', '>', '>='].includes(operator)) return 50; if (['+', '-'].includes(operator)) return 60; return 70; }
function quote(value: string): string { return JSON.stringify(value); }
