import type { CstNode, IToken } from 'chevrotain';
import type * as A from '../ast/nodes.js';
import { IdGenerator, type FileId, type SourceSpan, zeroSpan } from '../source.js';
import { baseCstVisitorConstructor } from './parser.js';
import { setSyntaxStart } from './syntax-metadata.js';

type Ctx = Record<string, Array<CstNode | IToken>>;
const isToken = (value: CstNode | IToken): value is IToken => 'image' in value;
const nodes = (ctx: Ctx, name: string): CstNode[] => (ctx[name] ?? []).filter((value): value is CstNode => !isToken(value));
const tokens = (ctx: Ctx, name: string): IToken[] => (ctx[name] ?? []).filter(isToken);
const firstToken = (ctx: Ctx, name: string): IToken | undefined => tokens(ctx, name)[0];
const firstNode = (ctx: Ctx, name: string): CstNode | undefined => nodes(ctx, name)[0];
const tokenText = (ctx: Ctx, name: string, index = 0): string => tokens(ctx, name)[index]?.image ?? '';
const unquote = (image: string): string => JSON.parse(image) as string;

function tokenSpan(fileId: FileId, token: IToken | undefined): SourceSpan {
	if (token === undefined) return zeroSpan(fileId);
	return {
		fileId,
		start: { offset: token.startOffset, line: token.startLine ?? 1, column: token.startColumn ?? 1 },
		end: { offset: token.endOffset ?? token.startOffset, line: token.endLine ?? token.startLine ?? 1, column: (token.endColumn ?? token.startColumn ?? 1) + 1 },
	};
}

function nodeSpan(fileId: FileId, node: CstNode | undefined): SourceSpan {
	if (node?.location === undefined) return zeroSpan(fileId);
	const location = node.location;
	return {
		fileId,
		start: { offset: location.startOffset ?? 0, line: location.startLine ?? 1, column: location.startColumn ?? 1 },
		end: { offset: location.endOffset ?? location.startOffset ?? 0, line: location.endLine ?? location.startLine ?? 1, column: (location.endColumn ?? location.startColumn ?? 1) + 1 },
	};
}

function contextSpan(fileId: FileId, ctx: Ctx): SourceSpan {
	const spans: SourceSpan[] = [];
	for (const values of Object.values(ctx)) {
		for (const value of values) spans.push(isToken(value) ? tokenSpan(fileId, value) : nodeSpan(fileId, value));
	}
	const meaningful = spans.filter(span => span.start.offset !== 0 || span.end.offset !== 0 || span.start.line !== 1 || span.start.column !== 1);
	if (meaningful.length === 0) return zeroSpan(fileId);
	const start = meaningful.reduce((left, right) => left.start.offset <= right.start.offset ? left : right).start;
	const end = meaningful.reduce((left, right) => left.end.offset >= right.end.offset ? left : right).end;
	return { fileId, start, end };
}

export class AstBuilder extends baseCstVisitorConstructor {
	readonly #fileId: FileId;
	readonly #ids = new IdGenerator();

	public constructor(fileId: FileId) {
		super();
		this.#fileId = fileId;
		this.validateVisitor();
	}

	private id(): number { return this.#ids.next(); }
	private visitNode<T>(node: CstNode | undefined): T { if (node === undefined) throw new Error('Missing CST node during AST construction'); return this.visit(node) as T; }
	private visitNodes<T>(list: readonly CstNode[]): T[] { return list.map(node => this.visitNode<T>(node)); }

	public module(ctx: Ctx): A.ModuleNode {
		const imports = this.visitNodes<A.ImportDeclaration>(nodes(ctx, 'importDeclaration'));
		const declarations = this.visitNodes<A.Declaration>(nodes(ctx, 'declaration'));
		return { id: this.id(), kind: 'Module', span: this.spanFromChildren([...imports, ...declarations]), unsafe: firstToken(ctx, 'KwUnsafe') !== undefined, imports, declarations };
	}

	public importDeclaration(ctx: Ctx): A.ImportDeclaration {
		const named = this.visitNodes<A.ImportItem>(nodes(ctx, 'importItem'));
		const identifiers = tokens(ctx, 'Identifier');
		const namespace = firstToken(ctx, 'Star') !== undefined;
		const namedClause = firstToken(ctx, 'LBrace') !== undefined;
		const sideEffect = !namedClause && !namespace && identifiers.length === 0;
		return setSyntaxStart({
			id: this.id(), kind: 'ImportDeclaration', span: nodeSpan(this.#fileId, this.currentNode(ctx)),
			public: firstToken(ctx, 'KwPub') !== undefined,
			sourceKind: firstToken(ctx, 'KwJs') === undefined ? 'virune' : 'javascript',
			typeOnly: firstToken(ctx, 'KwType') !== undefined,
			items: named,
			...(!sideEffect && !namedClause && !namespace ? { defaultImport: identifiers[0]?.image ?? '' } : {}),
			...(namespace ? { namespaceImport: identifiers[0]?.image ?? '' } : {}),
			source: unquote(tokenText(ctx, 'StringLiteral')),
		}, contextSpan(this.#fileId, ctx).start.offset);
	}

	public importItem(ctx: Ctx): A.ImportItem {
		const identifiers = tokens(ctx, 'Identifier');
		return { imported: identifiers[0]?.image ?? '', local: identifiers[1]?.image ?? identifiers[0]?.image ?? '', span: tokenSpan(this.#fileId, identifiers[0]) };
	}

	public declaration(ctx: Ctx): A.Declaration {
		const attributes = this.visitNodes<A.AttributeNode>(nodes(ctx, 'attribute'));
		const name = Object.keys(ctx).find(key => key !== 'attribute');
		const child = name === undefined ? undefined : firstNode(ctx, name);
		const declaration = this.visitNode<A.Declaration>(child);
		const result = { ...declaration, attributes } as A.Declaration;
		return setSyntaxStart(result, nodeSpan(this.#fileId, child).start.offset);
	}

	public attribute(ctx: Ctx): A.AttributeNode {
		return { id: this.id(), kind: 'Attribute', span: tokenSpan(this.#fileId, firstToken(ctx, 'At')), name: tokenText(ctx, 'Identifier'), arguments: firstNode(ctx, 'argumentList') === undefined ? [] : this.visitNode<A.Expression[]>(firstNode(ctx, 'argumentList')) };
	}

	public functionDeclaration(ctx: Ctx): A.FunctionDeclaration {
		const bodyNode = firstNode(ctx, 'block');
		const expressionNode = firstNode(ctx, 'expression');
		return {
			id: this.id(), kind: 'FunctionDeclaration', span: nodeSpan(this.#fileId, this.currentNode(ctx)), name: tokenText(ctx, 'Identifier'),
			public: firstToken(ctx, 'KwPub') !== undefined, async: firstToken(ctx, 'KwAsync') !== undefined, attributes: [],
			typeParameters: firstNode(ctx, 'typeParameters') === undefined ? [] : this.visitNode<A.TypeParameterNode[]>(firstNode(ctx, 'typeParameters')),
			parameters: firstNode(ctx, 'parameterList') === undefined ? [] : this.visitNode<A.ParameterNode[]>(firstNode(ctx, 'parameterList')),
			...(firstNode(ctx, 'typeReference') === undefined ? {} : { returnType: this.visitNode<A.TypeReferenceNode>(firstNode(ctx, 'typeReference')) }),
			effects: firstNode(ctx, 'usesClause') === undefined ? [] : this.visitNode<string[]>(firstNode(ctx, 'usesClause')),
			body: bodyNode === undefined ? this.visitNode<A.Expression>(expressionNode) : this.visitNode<A.BlockStatement>(bodyNode), expressionBody: bodyNode === undefined,
		};
	}

	public typeParameters(ctx: Ctx): A.TypeParameterNode[] { return tokens(ctx, 'Identifier').map(token => ({ name: token.image, span: tokenSpan(this.#fileId, token) })); }
	public parameterList(ctx: Ctx): A.ParameterNode[] { return this.visitNodes<A.ParameterNode>(nodes(ctx, 'parameter')); }
	public parameter(ctx: Ctx): A.ParameterNode { return setSyntaxStart({ name: tokenText(ctx, 'Identifier'), optional: firstToken(ctx, 'Question') !== undefined, type: this.visitNode(firstNode(ctx, 'typeReference')), span: nodeSpan(this.#fileId, this.currentNode(ctx)) }, contextSpan(this.#fileId, ctx).start.offset); }
	public usesClause(ctx: Ctx): string[] { return [...tokens(ctx, 'Identifier'), ...tokens(ctx, 'Star')].sort((left, right) => left.startOffset - right.startOffset).map(token => token.image); }

	public recordDeclaration(ctx: Ctx): A.RecordDeclaration {
		return { id: this.id(), kind: 'RecordDeclaration', span: nodeSpan(this.#fileId, this.currentNode(ctx)), name: tokenText(ctx, 'Identifier'), public: firstToken(ctx, 'KwPub') !== undefined, attributes: [], typeParameters: firstNode(ctx, 'typeParameters') === undefined ? [] : this.visitNode(firstNode(ctx, 'typeParameters')), fields: this.visitNodes(nodes(ctx, 'recordField')), derives: firstNode(ctx, 'derivesClause') === undefined ? [] : this.visitNode(firstNode(ctx, 'derivesClause')) };
	}
	public recordField(ctx: Ctx): A.RecordFieldNode { return setSyntaxStart({ name: tokenText(ctx, 'Identifier'), type: this.visitNode(firstNode(ctx, 'typeReference')), attributes: this.visitNodes<A.AttributeNode>(nodes(ctx, 'attribute')), span: nodeSpan(this.#fileId, this.currentNode(ctx)) }, contextSpan(this.#fileId, ctx).start.offset); }
	public derivesClause(ctx: Ctx): string[] { return tokens(ctx, 'Identifier').map(token => token.image); }
	public enumDeclaration(ctx: Ctx): A.EnumDeclaration { return { id: this.id(), kind: 'EnumDeclaration', span: nodeSpan(this.#fileId, this.currentNode(ctx)), name: tokenText(ctx, 'Identifier'), public: firstToken(ctx, 'KwPub') !== undefined, attributes: [], typeParameters: firstNode(ctx, 'typeParameters') === undefined ? [] : this.visitNode(firstNode(ctx, 'typeParameters')), variants: this.visitNodes(nodes(ctx, 'enumVariant')), derives: firstNode(ctx, 'derivesClause') === undefined ? [] : this.visitNode(firstNode(ctx, 'derivesClause')) }; }
	public enumVariant(ctx: Ctx): A.EnumVariantNode { return setSyntaxStart({ name: tokenText(ctx, 'Identifier'), values: this.visitNodes(nodes(ctx, 'typeReference')), span: nodeSpan(this.#fileId, this.currentNode(ctx)) }, contextSpan(this.#fileId, ctx).start.offset); }
	public newtypeDeclaration(ctx: Ctx): A.NewtypeDeclaration { return { id: this.id(), kind: 'NewtypeDeclaration', span: nodeSpan(this.#fileId, this.currentNode(ctx)), name: tokenText(ctx, 'Identifier'), public: firstToken(ctx, 'KwPub') !== undefined, attributes: [], underlying: this.visitNode(firstNode(ctx, 'typeReference')) }; }
	public typeAliasDeclaration(ctx: Ctx): A.TypeAliasDeclaration { return { id: this.id(), kind: 'TypeAliasDeclaration', span: nodeSpan(this.#fileId, this.currentNode(ctx)), name: tokenText(ctx, 'Identifier'), public: firstToken(ctx, 'KwPub') !== undefined, attributes: [], typeParameters: firstNode(ctx, 'typeParameters') === undefined ? [] : this.visitNode(firstNode(ctx, 'typeParameters')), target: this.visitNode(firstNode(ctx, 'typeReference')) }; }
	public externDeclaration(ctx: Ctx): A.ExternDeclaration { return { id: this.id(), kind: 'ExternDeclaration', span: nodeSpan(this.#fileId, this.currentNode(ctx)), module: unquote(tokenText(ctx, 'StringLiteral')), unsafe: firstToken(ctx, 'KwUnsafe') !== undefined, attributes: [], functions: this.visitNodes(nodes(ctx, 'externFunction')) }; }
	public externFunction(ctx: Ctx): A.ExternFunctionNode { const strings = tokens(ctx, 'StringLiteral'); return setSyntaxStart({ id: this.id(), kind: 'ExternFunction', span: nodeSpan(this.#fileId, this.currentNode(ctx)), name: tokenText(ctx, 'Identifier'), async: firstToken(ctx, 'KwAsync') !== undefined, parameters: firstNode(ctx, 'parameterList') === undefined ? [] : this.visitNode(firstNode(ctx, 'parameterList')), returnType: this.visitNode(firstNode(ctx, 'typeReference')), effects: firstNode(ctx, 'usesClause') === undefined ? [] : this.visitNode<string[]>(firstNode(ctx, 'usesClause')), jsName: unquote(strings[0]?.image ?? '""') }, contextSpan(this.#fileId, ctx).start.offset); }
	public testDeclaration(ctx: Ctx): A.TestDeclaration { return { id: this.id(), kind: 'TestDeclaration', span: nodeSpan(this.#fileId, this.currentNode(ctx)), name: unquote(tokenText(ctx, 'StringLiteral')), async: firstToken(ctx, 'KwAsync') !== undefined, attributes: [], body: this.visitNode(firstNode(ctx, 'block')) }; }
	public topLevelLetDeclaration(ctx: Ctx): A.TopLevelLetDeclaration { return { id: this.id(), kind: 'TopLevelLetDeclaration', span: nodeSpan(this.#fileId, this.currentNode(ctx)), name: tokenText(ctx, 'Identifier'), attributes: [], constant: firstToken(ctx, 'KwConst') !== undefined, public: firstToken(ctx, 'KwPub') !== undefined, ...(firstNode(ctx, 'typeReference') === undefined ? {} : { annotation: this.visitNode<A.TypeReferenceNode>(firstNode(ctx, 'typeReference')) }), value: this.visitNode(firstNode(ctx, 'expression')) }; }

	public typeReference(ctx: Ctx): A.TypeReferenceNode {
		const functionType = firstNode(ctx, 'functionTypeReference');
		const tupleType = firstNode(ctx, 'tupleTypeReference');
		if (functionType !== undefined) {
			const value = this.visitNode<A.FunctionTypeReference>(functionType);
			return { id: this.id(), kind: 'TypeReference', span: contextSpan(this.#fileId, ctx), name: '$Function', arguments: [], optional: firstToken(ctx, 'Question') !== undefined, functionType: value };
		}
		if (tupleType !== undefined) return { id: this.id(), kind: 'TypeReference', span: contextSpan(this.#fileId, ctx), name: '$Tuple', arguments: this.visitNodes(nodes(tupleType.children as Ctx, 'typeReference')), optional: firstToken(ctx, 'Question') !== undefined };
		const childTypes = nodes(ctx, 'typeReference');
		return { id: this.id(), kind: 'TypeReference', span: contextSpan(this.#fileId, ctx), name: tokenText(ctx, 'Identifier'), arguments: this.visitNodes(childTypes), optional: firstToken(ctx, 'Question') !== undefined };
	}

	public functionTypeReference(ctx: Ctx): A.FunctionTypeReference {
		const values = this.visitNodes<A.TypeReferenceNode>(nodes(ctx, 'typeReference'));
		return { async: firstToken(ctx, 'KwAsync') !== undefined, parameters: values.slice(0, -1), result: values.at(-1)!, effects: firstNode(ctx, 'usesClause') === undefined ? [] : this.visitNode<string[]>(firstNode(ctx, 'usesClause')) };
	}

	public block(ctx: Ctx): A.BlockStatement { return { id: this.id(), kind: 'BlockStatement', span: nodeSpan(this.#fileId, this.currentNode(ctx)), statements: this.visitNodes(nodes(ctx, 'statement')) }; }
	public statement(ctx: Ctx): A.Statement { const key = Object.keys(ctx)[0]; const child = firstNode(ctx, key ?? ''); return setSyntaxStart(this.visitNode<A.Statement>(child), nodeSpan(this.#fileId, child).start.offset); }
	public letStatement(ctx: Ctx): A.LetStatement { return { id: this.id(), kind: 'LetStatement', span: nodeSpan(this.#fileId, this.currentNode(ctx)), name: tokenText(ctx, 'Identifier'), mutable: firstToken(ctx, 'KwMut') !== undefined, ...(firstNode(ctx, 'typeReference') === undefined ? {} : { annotation: this.visitNode<A.TypeReferenceNode>(firstNode(ctx, 'typeReference')) }), value: this.visitNode(firstNode(ctx, 'expression')) }; }
	public returnStatement(ctx: Ctx): A.ReturnStatement { const expression = firstNode(ctx, 'expression'); return { id: this.id(), kind: 'ReturnStatement', span: nodeSpan(this.#fileId, this.currentNode(ctx)), ...(expression === undefined ? {} : { value: this.visitNode<A.Expression>(expression) }) }; }
	public ifStatement(ctx: Ctx): A.IfStatement { const blocks = nodes(ctx, 'block'); const nested = firstNode(ctx, 'ifStatement'); return { id: this.id(), kind: 'IfStatement', span: nodeSpan(this.#fileId, this.currentNode(ctx)), condition: this.visitNode(firstNode(ctx, 'expression')), thenBlock: this.visitNode(blocks[0]), ...(blocks[1] === undefined && nested === undefined ? {} : { elseBranch: blocks[1] === undefined ? this.visitNode<A.IfStatement>(nested) : this.visitNode<A.BlockStatement>(blocks[1]) }) }; }
	public forStatement(ctx: Ctx): A.ForStatement { return { id: this.id(), kind: 'ForStatement', span: nodeSpan(this.#fileId, this.currentNode(ctx)), name: tokenText(ctx, 'Identifier'), iterable: this.visitNode(firstNode(ctx, 'expression')), body: this.visitNode(firstNode(ctx, 'block')) }; }
	public whileStatement(ctx: Ctx): A.WhileStatement { return { id: this.id(), kind: 'WhileStatement', span: nodeSpan(this.#fileId, this.currentNode(ctx)), condition: this.visitNode(firstNode(ctx, 'expression')), body: this.visitNode(firstNode(ctx, 'block')) }; }
	public breakStatement(ctx: Ctx): A.BreakStatement { return { id: this.id(), kind: 'BreakStatement', span: nodeSpan(this.#fileId, this.currentNode(ctx)) }; }
	public continueStatement(ctx: Ctx): A.ContinueStatement { return { id: this.id(), kind: 'ContinueStatement', span: nodeSpan(this.#fileId, this.currentNode(ctx)) }; }
	public discardStatement(ctx: Ctx): A.DiscardStatement { return { id: this.id(), kind: 'DiscardStatement', span: nodeSpan(this.#fileId, this.currentNode(ctx)), expression: this.visitNode(firstNode(ctx, 'expression')) }; }
	public assignmentStatement(ctx: Ctx): A.AssignmentStatement { return { id: this.id(), kind: 'AssignmentStatement', span: nodeSpan(this.#fileId, this.currentNode(ctx)), name: tokenText(ctx, 'Identifier'), value: this.visitNode(firstNode(ctx, 'expression')) }; }
	public deferStatement(ctx: Ctx): A.DeferStatement { return { id: this.id(), kind: 'DeferStatement', span: nodeSpan(this.#fileId, this.currentNode(ctx)), expression: this.visitNode(firstNode(ctx, 'expression')) }; }
	public expressionStatement(ctx: Ctx): A.ExpressionStatement { return { id: this.id(), kind: 'ExpressionStatement', span: nodeSpan(this.#fileId, this.currentNode(ctx)), expression: this.visitNode(firstNode(ctx, 'expression')) }; }
	public lineEnd(): undefined { return undefined; }

	public expression(ctx: Ctx): A.Expression { return this.visitNode(firstNode(ctx, 'pipelineExpression')); }
	public pipelineExpression(ctx: Ctx): A.Expression { return this.foldBinary(ctx, 'orExpression', ['Pipe'], (operator, left, right) => ({ id: this.id(), kind: 'PipelineExpression', span: this.mergeSpan(left.span, right.span), left, right })); }
	public orExpression(ctx: Ctx): A.Expression { return this.foldBinary(ctx, 'andExpression', ['OrOr']); }
	public andExpression(ctx: Ctx): A.Expression { return this.foldBinary(ctx, 'equalityExpression', ['AndAnd']); }
	public equalityExpression(ctx: Ctx): A.Expression { return this.foldBinary(ctx, 'comparisonExpression', ['EqualEqual', 'BangEqual']); }
	public comparisonExpression(ctx: Ctx): A.Expression { return this.foldBinary(ctx, 'additiveExpression', ['Less', 'LessEqual', 'Greater', 'GreaterEqual']); }
	public additiveExpression(ctx: Ctx): A.Expression { return this.foldBinary(ctx, 'multiplicativeExpression', ['Plus', 'Minus']); }
	public multiplicativeExpression(ctx: Ctx): A.Expression { return this.foldBinary(ctx, 'unaryExpression', ['Star', 'Slash', 'Percent']); }

	public unaryExpression(ctx: Ctx): A.Expression {
		const postfix = firstNode(ctx, 'postfixExpression');
		if (postfix !== undefined) return this.visitNode(postfix);
		const operand = this.visitNode<A.Expression>(firstNode(ctx, 'unaryExpression'));
		const operator = ['Bang', 'Minus', 'KwAwait'].flatMap(name => tokens(ctx, name)).sort((a, b) => a.startOffset - b.startOffset)[0];
		if (operator?.image === 'await') {
			const awaitSpan = this.mergeSpan(tokenSpan(this.#fileId, operator), operand.kind === 'TryExpression' ? operand.operand.span : operand.span);
			const awaited: A.AwaitExpression = { id: this.id(), kind: 'AwaitExpression', span: awaitSpan, operand: operand.kind === 'TryExpression' ? operand.operand : operand };
			if (operand.kind === 'TryExpression') return { id: this.id(), kind: 'TryExpression', span: this.mergeSpan(tokenSpan(this.#fileId, operator), operand.span), operand: awaited };
			return awaited;
		}
		return { id: this.id(), kind: 'UnaryExpression', span: this.mergeSpan(tokenSpan(this.#fileId, operator), operand.span), operator: operator?.image === '-' ? '-' : '!', operand };
	}

	public postfixExpression(ctx: Ctx): A.Expression {
		let result = this.visitNode<A.Expression>(firstNode(ctx, 'primaryExpression'));
		type Event = { offset: number; kind: 'call' | 'field' | 'try' | 'update'; node?: CstNode; token?: IToken };
		const events: Event[] = [];
		for (const node of nodes(ctx, 'callSuffix')) events.push({ offset: node.location?.startOffset ?? 0, kind: 'call', node });
		for (const token of tokens(ctx, 'Dot')) events.push({ offset: token.startOffset, kind: 'field', token });
		for (const token of tokens(ctx, 'Question')) events.push({ offset: token.startOffset, kind: 'try', token });
		for (const token of tokens(ctx, 'KwWith')) events.push({ offset: token.startOffset, kind: 'update', token });
		const updateNodes = nodes(ctx, 'recordFieldBlock');
		const fieldTokens = tokens(ctx, 'IdentifierName');
		for (const event of events.sort((a, b) => a.offset - b.offset)) {
			if (event.kind === 'call') {
				const suffix = event.node!;
				const argsNode = firstNode(suffix.children as Ctx, 'argumentList');
				const typeArgsNode = firstNode(suffix.children as Ctx, 'typeArguments');
				const args = argsNode === undefined ? [] : this.visitNode<A.Expression[]>(argsNode);
				const typeArguments = typeArgsNode === undefined ? [] : this.visitNode<A.TypeReferenceNode[]>(typeArgsNode);
				result = { id: this.id(), kind: 'CallExpression', span: this.mergeSpan(result.span, nodeSpan(this.#fileId, suffix)), callee: result, typeArguments, arguments: args };
			} else if (event.kind === 'field') {
				const field = fieldTokens.find(token => token.startOffset > event.offset);
				result = { id: this.id(), kind: 'FieldExpression', span: this.mergeSpan(result.span, tokenSpan(this.#fileId, field)), target: result, field: field?.image ?? '' };
			} else if (event.kind === 'try') {
				result = { id: this.id(), kind: 'TryExpression', span: this.mergeSpan(result.span, tokenSpan(this.#fileId, event.token)), operand: result };
			} else {
				const update = updateNodes.find(node => (node.location?.startOffset ?? -1) > event.offset);
				result = { id: this.id(), kind: 'RecordUpdateExpression', span: this.mergeSpan(result.span, nodeSpan(this.#fileId, update)), base: result, entries: this.visitNode<A.RecordEntryNode[]>(update) };
			}
		}
		return result;
	}

	public typeArguments(ctx: Ctx): A.TypeReferenceNode[] { return this.visitNodes(nodes(ctx, 'typeReference')); }

	public argumentList(ctx: Ctx): A.Expression[] { return this.visitNodes(nodes(ctx, 'expression')); }
	public primaryExpression(ctx: Ctx): A.Expression {
		for (const name of ['recordExpression', 'listExpression', 'parenthesizedOrTupleExpression', 'conditionalExpression', 'matchExpression', 'lambdaExpression', 'parallelExpression']) {
			const child = firstNode(ctx, name); if (child !== undefined) return this.visitNode(child);
		}
		const token = Object.values(ctx).flat().filter(isToken).sort((a, b) => a.startOffset - b.startOffset)[0];
		if (token === undefined) return { id: this.id(), kind: 'WildcardExpression', span: zeroSpan(this.#fileId) };
		if (token.tokenType.name === 'Identifier') return { id: this.id(), kind: 'IdentifierExpression', span: tokenSpan(this.#fileId, token), name: token.image };
		if (token.tokenType.name === 'Underscore') return { id: this.id(), kind: 'WildcardExpression', span: tokenSpan(this.#fileId, token) };
		return this.literal(token);
	}
	public recordExpression(ctx: Ctx): A.RecordExpression { const typeArguments = firstNode(ctx, 'typeArguments'); return { id: this.id(), kind: 'RecordExpression', span: nodeSpan(this.#fileId, this.currentNode(ctx)), name: tokenText(ctx, 'Identifier'), typeArguments: typeArguments === undefined ? [] : this.visitNode<A.TypeReferenceNode[]>(typeArguments), entries: this.visitNode<A.RecordEntryNode[]>(firstNode(ctx, 'recordFieldBlock')) }; }
	public recordFieldBlock(ctx: Ctx): A.RecordEntryNode[] { return this.visitNodes(nodes(ctx, 'recordEntry')); }
	public recordEntry(ctx: Ctx): A.RecordEntryNode { const name = tokenText(ctx, 'Identifier'); const expression = firstNode(ctx, 'expression'); return { name, value: expression === undefined ? { id: this.id(), kind: 'IdentifierExpression', span: tokenSpan(this.#fileId, firstToken(ctx, 'Identifier')), name } : this.visitNode(expression), span: nodeSpan(this.#fileId, this.currentNode(ctx)) }; }
	public listExpression(ctx: Ctx): A.ListExpression { return { id: this.id(), kind: 'ListExpression', span: nodeSpan(this.#fileId, this.currentNode(ctx)), items: this.visitNodes(nodes(ctx, 'expression')) }; }
	public parenthesizedOrTupleExpression(ctx: Ctx): A.Expression { const values = this.visitNodes<A.Expression>(nodes(ctx, 'expression')); return values.length === 1 ? values[0] as A.Expression : { id: this.id(), kind: 'TupleExpression', span: nodeSpan(this.#fileId, this.currentNode(ctx)), items: values }; }
	public conditionalExpression(ctx: Ctx): A.ConditionalExpression { const expressions = this.visitNodes<A.Expression>(nodes(ctx, 'expression')); return { id: this.id(), kind: 'ConditionalExpression', span: nodeSpan(this.#fileId, this.currentNode(ctx)), condition: expressions[0]!, thenExpression: expressions[1]!, elseExpression: expressions[2]! }; }
	public matchExpression(ctx: Ctx): A.MatchExpression { return { id: this.id(), kind: 'MatchExpression', span: nodeSpan(this.#fileId, this.currentNode(ctx)), target: this.visitNode(firstNode(ctx, 'expression')), arms: this.visitNodes(nodes(ctx, 'matchArm')) }; }
	public matchArm(ctx: Ctx): A.MatchArmNode { const expressions = nodes(ctx, 'expression'); return { pattern: this.visitNode(firstNode(ctx, 'pattern')), ...(expressions.length > 1 ? { guard: this.visitNode<A.Expression>(expressions[0]) } : {}), expression: this.visitNode<A.Expression>(expressions.at(-1)), span: nodeSpan(this.#fileId, this.currentNode(ctx)) }; }
	public pattern(ctx: Ctx): A.Pattern { return this.visitNode(firstNode(ctx, 'orPattern')); }
	public orPattern(ctx: Ctx): A.Pattern {
		const alternatives = this.visitNodes<A.Pattern>(nodes(ctx, 'primaryPattern'));
		return alternatives.length === 1 ? alternatives[0] as A.Pattern : { id: this.id(), kind: 'OrPattern', span: nodeSpan(this.#fileId, this.currentNode(ctx)), alternatives };
	}
	public primaryPattern(ctx: Ctx): A.Pattern {
		for (const name of ['rangePattern', 'listPattern', 'tuplePattern', 'variantPattern', 'recordPattern']) { const child = firstNode(ctx, name); if (child !== undefined) return this.visitNode(child); }
		const token = Object.values(ctx).flat().filter(isToken).sort((a, b) => a.startOffset - b.startOffset)[0];
		if (token?.tokenType.name === 'Underscore') return { id: this.id(), kind: 'WildcardPattern', span: tokenSpan(this.#fileId, token) };
		if (token?.tokenType.name === 'Identifier') return /^[A-Z]/u.test(token.image) ? { id: this.id(), kind: 'VariantPattern', span: tokenSpan(this.#fileId, token), name: token.image, values: [] } : { id: this.id(), kind: 'BindingPattern', span: tokenSpan(this.#fileId, token), name: token.image };
		const literal = this.literal(token);
		return { id: this.id(), kind: 'LiteralPattern', span: literal.span, literalKind: literal.literalKind === 'Bool' ? 'Bool' : literal.literalKind === 'Int' ? 'Int' : 'String', value: literal.value as string | number | boolean };
	}
	public rangePattern(ctx: Ctx): A.RangePattern { const values = tokens(ctx, 'IntLiteral').map(token => Number(token.image.replaceAll('_', ''))); return { id: this.id(), kind: 'RangePattern', span: nodeSpan(this.#fileId, this.currentNode(ctx)), start: values[0] ?? 0, end: values[1] ?? 0 }; }
	public listPattern(ctx: Ctx): A.ListPattern {
		const spread = firstToken(ctx, 'Spread');
		const restToken = spread === undefined ? undefined : Object.values(ctx).flat().filter(isToken).filter(token => token.startOffset > spread.startOffset).sort((a, b) => a.startOffset - b.startOffset)[0];
		const rest = restToken === undefined ? undefined : restToken.tokenType.name === 'Underscore' ? { id: this.id(), kind: 'WildcardPattern' as const, span: tokenSpan(this.#fileId, restToken) } : { id: this.id(), kind: 'BindingPattern' as const, span: tokenSpan(this.#fileId, restToken), name: restToken.image };
		return { id: this.id(), kind: 'ListPattern', span: nodeSpan(this.#fileId, this.currentNode(ctx)), items: this.visitNodes<A.Pattern>(nodes(ctx, 'pattern')), ...(rest === undefined ? {} : { rest }) };
	}
	public tuplePattern(ctx: Ctx): A.TuplePattern { return { id: this.id(), kind: 'TuplePattern', span: nodeSpan(this.#fileId, this.currentNode(ctx)), items: this.visitNodes(nodes(ctx, 'pattern')) }; }
	public variantPattern(ctx: Ctx): A.VariantPattern { return { id: this.id(), kind: 'VariantPattern', span: nodeSpan(this.#fileId, this.currentNode(ctx)), name: tokenText(ctx, 'Identifier'), values: this.visitNodes(nodes(ctx, 'pattern')) }; }
	public recordPattern(ctx: Ctx): A.RecordPattern { return { id: this.id(), kind: 'RecordPattern', span: nodeSpan(this.#fileId, this.currentNode(ctx)), name: tokenText(ctx, 'Identifier'), fields: this.visitNodes(nodes(ctx, 'recordPatternField')), rest: firstToken(ctx, 'Spread') !== undefined }; }
	public recordPatternField(ctx: Ctx): A.RecordPatternField { const name = tokenText(ctx, 'Identifier'); const patternNode = firstNode(ctx, 'pattern'); return { name, pattern: patternNode === undefined ? { id: this.id(), kind: 'BindingPattern', span: tokenSpan(this.#fileId, firstToken(ctx, 'Identifier')), name } : this.visitNode(patternNode), span: nodeSpan(this.#fileId, this.currentNode(ctx)) }; }
	public lambdaExpression(ctx: Ctx): A.LambdaExpression {
		const block = firstNode(ctx, 'block');
		return {
			id: this.id(), kind: 'LambdaExpression', span: nodeSpan(this.#fileId, this.currentNode(ctx)), async: firstToken(ctx, 'KwAsync') !== undefined,
			parameters: firstNode(ctx, 'lambdaParameterList') === undefined ? [] : this.visitNode(firstNode(ctx, 'lambdaParameterList')),
			...(firstNode(ctx, 'typeReference') === undefined ? {} : { returnType: this.visitNode<A.TypeReferenceNode>(firstNode(ctx, 'typeReference')) }),
			effects: firstNode(ctx, 'usesClause') === undefined ? [] : this.visitNode<string[]>(firstNode(ctx, 'usesClause')),
			body: block === undefined ? this.visitNode(firstNode(ctx, 'expression')) : this.visitNode(block), expressionBody: block === undefined,
		};
	}
	public lambdaParameterList(ctx: Ctx): A.LambdaParameterNode[] { return this.visitNodes(nodes(ctx, 'lambdaParameter')); }
	public lambdaParameter(ctx: Ctx): A.LambdaParameterNode { return { name: tokenText(ctx, 'Identifier'), ...(firstNode(ctx, 'typeReference') === undefined ? {} : { annotation: this.visitNode<A.TypeReferenceNode>(firstNode(ctx, 'typeReference')) }), span: nodeSpan(this.#fileId, this.currentNode(ctx)) }; }
	public parallelExpression(ctx: Ctx): A.ParallelExpression { return { id: this.id(), kind: 'ParallelExpression', span: nodeSpan(this.#fileId, this.currentNode(ctx)), tryMode: firstToken(ctx, 'KwTry') !== undefined, entries: this.visitNodes(nodes(ctx, 'parallelEntry')) }; }
	public parallelEntry(ctx: Ctx): A.ParallelEntryNode { return { name: tokenText(ctx, 'Identifier'), value: this.visitNode(firstNode(ctx, 'expression')), span: nodeSpan(this.#fileId, this.currentNode(ctx)) }; }

	private foldBinary(ctx: Ctx, childName: string, operatorNames: readonly string[], factory?: (operator: string, left: A.Expression, right: A.Expression) => A.Expression): A.Expression {
		const values = this.visitNodes<A.Expression>(nodes(ctx, childName));
		const operators = operatorNames.flatMap(name => tokens(ctx, name)).sort((a, b) => a.startOffset - b.startOffset);
		let result = values[0]!;
		operators.forEach((operator, index) => {
			const right = values[index + 1]!;
			result = factory?.(operator.image, result, right) ?? { id: this.id(), kind: 'BinaryExpression', span: this.mergeSpan(result.span, right.span), operator: operator.image, left: result, right };
		});
		return result;
	}

	private literal(token: IToken | undefined): A.LiteralExpression {
		if (token === undefined) return { id: this.id(), kind: 'LiteralExpression', span: zeroSpan(this.#fileId), literalKind: 'String', value: '' };
		const span = tokenSpan(this.#fileId, token);
		switch (token.tokenType.name) {
			case 'StringLiteral': return { id: this.id(), kind: 'LiteralExpression', span, literalKind: 'String', value: unquote(token.image) };
			case 'BigIntLiteral': return { id: this.id(), kind: 'LiteralExpression', span, literalKind: 'BigInt', value: BigInt(token.image.slice(0, -1).replaceAll('_', '')) };
			case 'FloatLiteral': return { id: this.id(), kind: 'LiteralExpression', span, literalKind: 'Float', value: Number(token.image.replaceAll('_', '')) };
			case 'IntLiteral': return { id: this.id(), kind: 'LiteralExpression', span, literalKind: 'Int', value: Number(token.image.replaceAll('_', '')) };
			case 'KwTrue': return { id: this.id(), kind: 'LiteralExpression', span, literalKind: 'Bool', value: true };
			case 'KwFalse': return { id: this.id(), kind: 'LiteralExpression', span, literalKind: 'Bool', value: false };
			default: return { id: this.id(), kind: 'LiteralExpression', span, literalKind: 'String', value: token.image };
		}
	}

	private mergeSpan(left: SourceSpan, right: SourceSpan): SourceSpan { return { fileId: left.fileId, start: left.start, end: right.end }; }
	private spanFromChildren(children: readonly { readonly span: SourceSpan }[]): SourceSpan { return children.length === 0 ? zeroSpan(this.#fileId) : this.mergeSpan(children[0]!.span, children.at(-1)!.span); }
	private currentNode(ctx: Ctx): CstNode | undefined { return Object.values(ctx).flat().find((value): value is CstNode => !isToken(value)); }
}

export function buildAst(fileId: FileId, cst: CstNode): A.ModuleNode { return new AstBuilder(fileId).visit(cst) as A.ModuleNode; }
