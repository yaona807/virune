import type { NodeId, SourceSpan, SymbolId, TypeId } from '../source.js';

export interface AstNode { readonly id: NodeId; readonly kind: string; readonly span: SourceSpan; }
export interface ModuleNode extends AstNode { readonly kind: 'Module'; readonly unsafe: boolean; readonly imports: readonly ImportDeclaration[]; readonly declarations: readonly Declaration[]; }
export interface ImportItem { readonly imported: string; readonly local: string; readonly span: SourceSpan; }
export interface ImportDeclaration extends AstNode {
	readonly kind: 'ImportDeclaration';
	readonly public: boolean;
	readonly sourceKind: 'virune' | 'javascript';
	readonly typeOnly: boolean;
	readonly items: readonly ImportItem[];
	readonly defaultImport?: string;
	readonly namespaceImport?: string;
	readonly source: string;
}
export interface AttributeNode extends AstNode { readonly kind: 'Attribute'; readonly name: string; readonly arguments: readonly Expression[]; }

export interface FunctionTypeReference { readonly async: boolean; readonly parameters: readonly TypeReferenceNode[]; readonly result: TypeReferenceNode; readonly effects: readonly string[]; }
export interface TypeReferenceNode extends AstNode { readonly kind: 'TypeReference'; readonly name: string; readonly arguments: readonly TypeReferenceNode[]; readonly optional: boolean; readonly functionType?: FunctionTypeReference; resolvedTypeId?: TypeId; }
export interface TypeParameterNode { readonly name: string; readonly span: SourceSpan; }
export interface ParameterNode { readonly name: string; readonly optional: boolean; readonly type: TypeReferenceNode; readonly span: SourceSpan; symbolId?: SymbolId; }
export type Declaration = FunctionDeclaration | RecordDeclaration | EnumDeclaration | NewtypeDeclaration | TypeAliasDeclaration | ExternDeclaration | TestDeclaration | TopLevelLetDeclaration;

export interface FunctionDeclaration extends AstNode {
	readonly kind: 'FunctionDeclaration'; readonly name: string; readonly public: boolean; readonly async: boolean;
	readonly attributes: readonly AttributeNode[]; readonly typeParameters: readonly TypeParameterNode[]; readonly parameters: readonly ParameterNode[];
	readonly returnType?: TypeReferenceNode; readonly effects: readonly string[]; readonly body: BlockStatement | Expression;
	readonly expressionBody: boolean; symbolId?: SymbolId; inferredTypeId?: TypeId;
}
export interface RecordFieldNode { readonly name: string; readonly type: TypeReferenceNode; readonly attributes: readonly AttributeNode[]; readonly span: SourceSpan; }
export interface RecordDeclaration extends AstNode {
	readonly kind: 'RecordDeclaration'; readonly name: string; readonly public: boolean; readonly attributes: readonly AttributeNode[];
	readonly typeParameters: readonly TypeParameterNode[]; readonly fields: readonly RecordFieldNode[]; readonly derives: readonly string[]; readonly definitionId?: string; symbolId?: SymbolId;
}
export interface EnumVariantNode { readonly name: string; readonly values: readonly TypeReferenceNode[]; readonly span: SourceSpan; symbolId?: SymbolId; }
export interface EnumDeclaration extends AstNode {
	readonly kind: 'EnumDeclaration'; readonly name: string; readonly public: boolean; readonly attributes: readonly AttributeNode[];
	readonly typeParameters: readonly TypeParameterNode[]; readonly variants: readonly EnumVariantNode[]; readonly derives: readonly string[]; readonly definitionId?: string; symbolId?: SymbolId;
}
export interface NewtypeDeclaration extends AstNode { readonly kind: 'NewtypeDeclaration'; readonly name: string; readonly public: boolean; readonly attributes: readonly AttributeNode[]; readonly underlying: TypeReferenceNode; readonly definitionId?: string; symbolId?: SymbolId; }
export interface TypeAliasDeclaration extends AstNode { readonly kind: 'TypeAliasDeclaration'; readonly name: string; readonly public: boolean; readonly attributes: readonly AttributeNode[]; readonly typeParameters: readonly TypeParameterNode[]; readonly target: TypeReferenceNode; readonly definitionId?: string; symbolId?: SymbolId; }

export interface ExternFunctionNode extends AstNode { readonly kind: 'ExternFunction'; readonly name: string; readonly async: boolean; readonly parameters: readonly ParameterNode[]; readonly returnType: TypeReferenceNode; readonly effects: readonly string[]; readonly jsName: string; symbolId?: SymbolId; }
export interface ExternDeclaration extends AstNode { readonly kind: 'ExternDeclaration'; readonly module: string; readonly unsafe: boolean; readonly attributes: readonly AttributeNode[]; readonly functions: readonly ExternFunctionNode[]; }
export interface TestDeclaration extends AstNode { readonly kind: 'TestDeclaration'; readonly name: string; readonly async: boolean; readonly attributes: readonly AttributeNode[]; readonly body: BlockStatement; }
export interface TopLevelLetDeclaration extends AstNode {
	readonly kind: 'TopLevelLetDeclaration'; readonly name: string; readonly attributes: readonly AttributeNode[];
	readonly constant: boolean; readonly public: boolean; readonly annotation?: TypeReferenceNode; readonly value: Expression;
	symbolId?: SymbolId; inferredTypeId?: TypeId;
}

export type Statement = LetStatement | ReturnStatement | IfStatement | ForStatement | WhileStatement | BreakStatement | ContinueStatement | DiscardStatement | AssignmentStatement | DeferStatement | ExpressionStatement;
export interface BlockStatement extends AstNode { readonly kind: 'BlockStatement'; readonly statements: readonly Statement[]; }
export interface LetStatement extends AstNode { readonly kind: 'LetStatement'; readonly name: string; readonly mutable: boolean; readonly annotation?: TypeReferenceNode; readonly value: Expression; symbolId?: SymbolId; inferredTypeId?: TypeId; }
export interface ReturnStatement extends AstNode { readonly kind: 'ReturnStatement'; readonly value?: Expression; }
export interface IfStatement extends AstNode { readonly kind: 'IfStatement'; readonly condition: Expression; readonly thenBlock: BlockStatement; readonly elseBranch?: BlockStatement | IfStatement; }
export interface ForStatement extends AstNode { readonly kind: 'ForStatement'; readonly name: string; readonly iterable: Expression; readonly body: BlockStatement; symbolId?: SymbolId; }
export interface WhileStatement extends AstNode { readonly kind: 'WhileStatement'; readonly condition: Expression; readonly body: BlockStatement; }
export interface BreakStatement extends AstNode { readonly kind: 'BreakStatement'; }
export interface ContinueStatement extends AstNode { readonly kind: 'ContinueStatement'; }
export interface DiscardStatement extends AstNode { readonly kind: 'DiscardStatement'; readonly expression: Expression; }
export interface AssignmentStatement extends AstNode { readonly kind: 'AssignmentStatement'; readonly name: string; readonly value: Expression; targetSymbolId?: SymbolId; }
export interface DeferStatement extends AstNode { readonly kind: 'DeferStatement'; readonly expression: Expression; }
export interface ExpressionStatement extends AstNode { readonly kind: 'ExpressionStatement'; readonly expression: Expression; }

export type Expression = LiteralExpression | IdentifierExpression | CallExpression | FieldExpression | BinaryExpression | UnaryExpression | PipelineExpression | TryExpression | AwaitExpression | RecordExpression | RecordUpdateExpression | ListExpression | TupleExpression | ConditionalExpression | MatchExpression | LambdaExpression | ParallelExpression | WildcardExpression;
export interface ExpressionBase extends AstNode { inferredTypeId?: TypeId; foreignBridge?: 'string' | 'bool' | 'float' | 'bigint' | 'unit' | 'unknown'; }
export interface LiteralExpression extends ExpressionBase { readonly kind: 'LiteralExpression'; readonly literalKind: 'String' | 'Int' | 'Float' | 'BigInt' | 'Bool'; readonly value: string | number | bigint | boolean; }
export interface IdentifierExpression extends ExpressionBase { readonly kind: 'IdentifierExpression'; readonly name: string; symbolId?: SymbolId; }
export interface WildcardExpression extends ExpressionBase { readonly kind: 'WildcardExpression'; }
export interface CallExpression extends ExpressionBase { readonly kind: 'CallExpression'; readonly callee: Expression; readonly typeArguments: readonly TypeReferenceNode[]; readonly arguments: readonly Expression[]; foreignCall?: true; }
export interface FieldExpression extends ExpressionBase { readonly kind: 'FieldExpression'; readonly target: Expression; readonly field: string; }
export interface BinaryExpression extends ExpressionBase { readonly kind: 'BinaryExpression'; readonly operator: string; readonly left: Expression; readonly right: Expression; }
export interface UnaryExpression extends ExpressionBase { readonly kind: 'UnaryExpression'; readonly operator: '!' | '-'; readonly operand: Expression; }
export interface PipelineExpression extends ExpressionBase { readonly kind: 'PipelineExpression'; readonly left: Expression; readonly right: Expression; }
export interface TryExpression extends ExpressionBase { readonly kind: 'TryExpression'; readonly operand: Expression; }
export interface AwaitExpression extends ExpressionBase { readonly kind: 'AwaitExpression'; readonly operand: Expression; }
export interface RecordEntryNode { readonly name: string; readonly value: Expression; readonly span: SourceSpan; }
export interface RecordExpression extends ExpressionBase { readonly kind: 'RecordExpression'; readonly name: string; readonly typeArguments: readonly TypeReferenceNode[]; readonly entries: readonly RecordEntryNode[]; symbolId?: SymbolId; }
export interface RecordUpdateExpression extends ExpressionBase { readonly kind: 'RecordUpdateExpression'; readonly base: Expression; readonly entries: readonly RecordEntryNode[]; }
export interface ListExpression extends ExpressionBase { readonly kind: 'ListExpression'; readonly items: readonly Expression[]; }
export interface TupleExpression extends ExpressionBase { readonly kind: 'TupleExpression'; readonly items: readonly Expression[]; }
export interface ConditionalExpression extends ExpressionBase { readonly kind: 'ConditionalExpression'; readonly condition: Expression; readonly thenExpression: Expression; readonly elseExpression: Expression; }
export interface MatchArmNode { readonly pattern: Pattern; readonly guard?: Expression; readonly expression: Expression; readonly span: SourceSpan; }
export interface MatchExpression extends ExpressionBase { readonly kind: 'MatchExpression'; readonly target: Expression; readonly arms: readonly MatchArmNode[]; }
export interface LambdaParameterNode { readonly name: string; readonly annotation?: TypeReferenceNode; readonly span: SourceSpan; symbolId?: SymbolId; }
export interface LambdaExpression extends ExpressionBase {
	readonly kind: 'LambdaExpression'; readonly async: boolean; readonly parameters: readonly LambdaParameterNode[];
	readonly returnType?: TypeReferenceNode; readonly effects: readonly string[]; readonly body: Expression | BlockStatement; readonly expressionBody: boolean;
}
export interface ParallelEntryNode { readonly name: string; readonly value: Expression; readonly span: SourceSpan; }
export interface ParallelExpression extends ExpressionBase { readonly kind: 'ParallelExpression'; readonly tryMode: boolean; readonly entries: readonly ParallelEntryNode[]; }

export type Pattern = WildcardPattern | BindingPattern | LiteralPattern | VariantPattern | RecordPattern | OrPattern | ListPattern | TuplePattern | RangePattern;
export interface PatternBase extends AstNode {}
export interface WildcardPattern extends PatternBase { readonly kind: 'WildcardPattern'; }
export interface BindingPattern extends PatternBase { readonly kind: 'BindingPattern'; readonly name: string; symbolId?: SymbolId; }
export interface LiteralPattern extends PatternBase { readonly kind: 'LiteralPattern'; readonly literalKind: 'String' | 'Int' | 'Bool'; readonly value: string | number | boolean; }
export interface VariantPattern extends PatternBase { readonly kind: 'VariantPattern'; readonly name: string; readonly values: readonly Pattern[]; symbolId?: SymbolId; }
export interface RecordPatternField { readonly name: string; readonly pattern: Pattern; readonly span: SourceSpan; }
export interface RecordPattern extends PatternBase { readonly kind: 'RecordPattern'; readonly name: string; readonly fields: readonly RecordPatternField[]; readonly rest: boolean; symbolId?: SymbolId; }
export interface OrPattern extends PatternBase { readonly kind: 'OrPattern'; readonly alternatives: readonly Pattern[]; }
export interface ListPattern extends PatternBase { readonly kind: 'ListPattern'; readonly items: readonly Pattern[]; readonly rest?: BindingPattern | WildcardPattern; }
export interface TuplePattern extends PatternBase { readonly kind: 'TuplePattern'; readonly items: readonly Pattern[]; }
export interface RangePattern extends PatternBase { readonly kind: 'RangePattern'; readonly start: number; readonly end: number; }
