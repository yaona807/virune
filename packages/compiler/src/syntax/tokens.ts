import { Lexer, createToken, type IToken, type TokenType } from 'chevrotain';

const keyword = (name: string, pattern: RegExp): TokenType => createToken({ name, pattern, longer_alt: Identifier, categories: [IdentifierName] });

export const WhiteSpace = createToken({ name: 'WhiteSpace', pattern: /[ \t\f]+/, group: Lexer.SKIPPED });
export const ModuleDocumentationComment = createToken({ name: 'ModuleDocumentationComment', pattern: /\/\/![^\r\n]*/, group: 'comments' });
export const DocumentationComment = createToken({ name: 'DocumentationComment', pattern: /\/\/\/(?!\/)[^\r\n]*/, group: 'comments' });
export const LineComment = createToken({ name: 'LineComment', pattern: /\/\/[^\r\n]*/, group: 'comments' });
export const NewLine = createToken({ name: 'NewLine', pattern: /\r?\n/ });

export const FatArrow = createToken({ name: 'FatArrow', pattern: /=>/ });
export const ThinArrow = createToken({ name: 'ThinArrow', pattern: /->/ });
export const Pipe = createToken({ name: 'Pipe', pattern: /\|>/ });
export const EqualEqual = createToken({ name: 'EqualEqual', pattern: /==/ });
export const BangEqual = createToken({ name: 'BangEqual', pattern: /!=/ });
export const LessEqual = createToken({ name: 'LessEqual', pattern: /<=/ });
export const GreaterEqual = createToken({ name: 'GreaterEqual', pattern: />=/ });
export const AndAnd = createToken({ name: 'AndAnd', pattern: /&&/ });
export const OrOr = createToken({ name: 'OrOr', pattern: /\|\|/ });
export const RangeInclusive = createToken({ name: 'RangeInclusive', pattern: /\.\.=/ });
export const Spread = createToken({ name: 'Spread', pattern: /\.\.\./ });
export const Bar = createToken({ name: 'Bar', pattern: /\|/ });

export const IdentifierName = createToken({ name: 'IdentifierName', pattern: Lexer.NA });
export const Identifier = createToken({ name: 'Identifier', pattern: /[A-Za-z_][A-Za-z0-9_]*/, categories: [IdentifierName] });
export const KwAs = keyword('KwAs', /as\b/);
export const KwAsync = keyword('KwAsync', /async\b/);
export const KwAwait = keyword('KwAwait', /await\b/);
export const KwBreak = keyword('KwBreak', /break\b/);
export const KwConst = keyword('KwConst', /const\b/);
export const KwContinue = keyword('KwContinue', /continue\b/);
export const KwDefer = keyword('KwDefer', /defer\b/);
export const KwDerives = keyword('KwDerives', /derives\b/);
export const KwDiscard = keyword('KwDiscard', /discard\b/);
export const KwElse = keyword('KwElse', /else\b/);
export const KwEnum = keyword('KwEnum', /enum\b/);
export const KwExtern = keyword('KwExtern', /extern\b/);
export const KwFalse = keyword('KwFalse', /false\b/);
export const KwFn = keyword('KwFn', /fn\b/);
export const KwFor = keyword('KwFor', /for\b/);
export const KwFrom = keyword('KwFrom', /from\b/);
export const KwIf = keyword('KwIf', /if\b/);
export const KwImport = keyword('KwImport', /import\b/);
export const KwIn = keyword('KwIn', /in\b/);
export const KwLet = keyword('KwLet', /let\b/);
export const KwMatch = keyword('KwMatch', /match\b/);
export const KwModule = keyword('KwModule', /module\b/);
export const KwMut = keyword('KwMut', /mut\b/);
export const KwNewtype = keyword('KwNewtype', /newtype\b/);
export const KwParallel = keyword('KwParallel', /parallel\b/);
export const KwPub = keyword('KwPub', /pub\b/);
export const KwRecord = keyword('KwRecord', /record\b/);
export const KwReturn = keyword('KwReturn', /return\b/);
export const KwTest = keyword('KwTest', /test\b/);
export const KwThen = keyword('KwThen', /then\b/);
export const KwTrue = keyword('KwTrue', /true\b/);
export const KwTry = keyword('KwTry', /try\b/);
export const KwType = keyword('KwType', /type\b/);
export const KwUnsafe = keyword('KwUnsafe', /unsafe\b/);
export const KwUses = keyword('KwUses', /uses\b/);
export const KwWhile = keyword('KwWhile', /while\b/);
export const KwWith = keyword('KwWith', /with\b/);
export const KwJs = keyword('KwJs', /js\b/);

export const BigIntLiteral = createToken({ name: 'BigIntLiteral', pattern: /(?:0x[0-9a-fA-F](?:_?[0-9a-fA-F])*|0b[01](?:_?[01])*|(?:0|[1-9](?:_?[0-9])*))n/ });
export const FloatLiteral = createToken({ name: 'FloatLiteral', pattern: /(?:(?:0|[1-9](?:_?[0-9])*)\.[0-9](?:_?[0-9])*(?:[eE][+-]?[0-9](?:_?[0-9])*)?|(?:0|[1-9](?:_?[0-9])*)[eE][+-]?[0-9](?:_?[0-9])*)/ });
export const IntLiteral = createToken({ name: 'IntLiteral', pattern: /0x[0-9a-fA-F](?:_?[0-9a-fA-F])*|0b[01](?:_?[01])*|0|[1-9](?:_?[0-9])*/ });
export const StringLiteral = createToken({ name: 'StringLiteral', pattern: /"(?:\\["\\nrt]|[^"\\\r\n])*"/ });

export const LParen = createToken({ name: 'LParen', pattern: /\(/ });
export const RParen = createToken({ name: 'RParen', pattern: /\)/ });
export const LBrace = createToken({ name: 'LBrace', pattern: /\{/ });
export const RBrace = createToken({ name: 'RBrace', pattern: /\}/ });
export const LBracket = createToken({ name: 'LBracket', pattern: /\[/ });
export const RBracket = createToken({ name: 'RBracket', pattern: /\]/ });
export const Comma = createToken({ name: 'Comma', pattern: /,/ });
export const Colon = createToken({ name: 'Colon', pattern: /:/ });
export const Dot = createToken({ name: 'Dot', pattern: /\./ });
export const Question = createToken({ name: 'Question', pattern: /\?/ });
export const At = createToken({ name: 'At', pattern: /@/ });
export const Equals = createToken({ name: 'Equals', pattern: /=/ });
export const Less = createToken({ name: 'Less', pattern: /</ });
export const Greater = createToken({ name: 'Greater', pattern: />/ });
export const Plus = createToken({ name: 'Plus', pattern: /\+/ });
export const Minus = createToken({ name: 'Minus', pattern: /-/ });
export const Star = createToken({ name: 'Star', pattern: /\*/ });
export const Slash = createToken({ name: 'Slash', pattern: /\// });
export const Percent = createToken({ name: 'Percent', pattern: /%/ });
export const Bang = createToken({ name: 'Bang', pattern: /!/ });
export const Underscore = createToken({ name: 'Underscore', pattern: /_/, longer_alt: Identifier });

export const allTokens: TokenType[] = [
	WhiteSpace, ModuleDocumentationComment, DocumentationComment, LineComment, NewLine,
	FatArrow, ThinArrow, Pipe, EqualEqual, BangEqual, LessEqual, GreaterEqual, AndAnd, OrOr, RangeInclusive, Spread, Bar,
	IdentifierName,
	KwAs, KwAsync, KwAwait, KwBreak, KwConst, KwContinue, KwDefer, KwDerives, KwDiscard, KwElse, KwEnum, KwExtern, KwFalse, KwFn, KwFor,
	KwFrom, KwIf, KwImport, KwIn, KwLet, KwMatch, KwModule, KwMut, KwNewtype, KwParallel, KwPub, KwRecord,
	KwReturn, KwTest, KwThen, KwTrue, KwTry, KwType, KwUnsafe, KwUses, KwWhile, KwWith, KwJs,
	BigIntLiteral, FloatLiteral, IntLiteral, StringLiteral,
	Underscore, Identifier,
	LParen, RParen, LBrace, RBrace, LBracket, RBracket, Comma, Colon, Dot, Question, At, Equals,
	Less, Greater, Plus, Minus, Star, Slash, Percent, Bang,
];

export const viruneLexer = new Lexer(allTokens, { ensureOptimizations: true, positionTracking: 'full' });

export interface LexResult {
	readonly tokens: readonly IToken[];
	readonly errors: readonly import('chevrotain').ILexingError[];
	readonly comments: readonly IToken[];
}

const softAfter = new Set(['Pipe', 'EqualEqual', 'BangEqual', 'LessEqual', 'GreaterEqual', 'AndAnd', 'OrOr', 'Equals', 'Less', 'Greater', 'Plus', 'Minus', 'Star', 'Slash', 'Percent', 'Comma', 'LParen', 'LBracket']);
const softBefore = new Set(['Pipe', 'EqualEqual', 'BangEqual', 'LessEqual', 'GreaterEqual', 'AndAnd', 'OrOr', 'Less', 'Greater', 'Plus', 'Minus', 'Star', 'Slash', 'Percent', 'RParen', 'RBracket', 'KwElse']);

function normalizeNewLines(input: readonly IToken[]): IToken[] {
	const output: IToken[] = [];
	let parenDepth = 0;
	let bracketDepth = 0;
	for (let index = 0; index < input.length; index++) {
		const token = input[index]!;
		const name = token.tokenType.name;
		if (name === 'NewLine') {
			const previous = output.at(-1);
			const next = input.slice(index + 1).find(item => item.tokenType.name !== 'NewLine');
			const soft = parenDepth > 0 || bracketDepth > 0 || (previous !== undefined && softAfter.has(previous.tokenType.name)) || (next !== undefined && softBefore.has(next.tokenType.name));
			if (!soft && previous?.tokenType.name !== 'NewLine') output.push(token);
			continue;
		}
		output.push(token);
		if (name === 'LParen') parenDepth++; else if (name === 'RParen') parenDepth = Math.max(0, parenDepth - 1);
		if (name === 'LBracket') bracketDepth++; else if (name === 'RBracket') bracketDepth = Math.max(0, bracketDepth - 1);
	}
	return output;
}

export function lex(text: string): LexResult {
	const normalized = text.endsWith('\n') ? text : `${text}\n`;
	const result = viruneLexer.tokenize(normalized);
	return { tokens: normalizeNewLines(result.tokens), errors: result.errors, comments: result.groups.comments ?? [] };
}
