import { CstParser, type CstNode, type IParserErrorMessageProvider, type IRecognitionException, type IToken } from 'chevrotain';
import {
	allTokens, AndAnd, At, Bang, BangEqual, Bar, BigIntLiteral, Colon, Comma, Dot, EqualEqual, Equals, FatArrow,
	FloatLiteral, Greater, GreaterEqual, Identifier, IdentifierName, IntLiteral, KwAs, KwAsync, KwAwait, KwBreak, KwConst, KwContinue, KwDerives,
	KwDefer, KwDiscard, KwElse, KwEnum, KwExtern, KwFalse, KwFn, KwFor, KwFrom, KwIf, KwImport, KwIn, KwJs, KwLet, KwMatch, KwModule,
	KwMut, KwNewtype, KwParallel, KwPub, KwRecord, KwReturn, KwTest, KwThen, KwTrue, KwTry, KwType,
	KwUnsafe, KwUses, KwWhile, KwWith, LBrace, LBracket, Less, LessEqual, LParen, Minus, NewLine, OrOr,
	Percent, Pipe, Plus, Question, RangeInclusive, RBrace, RBracket, RParen, Slash, Spread, Star, StringLiteral, ThinArrow, Underscore,
} from './tokens.js';

const errorProvider: IParserErrorMessageProvider = {
	buildMismatchTokenMessage({ expected, actual }): string {
		return `Expected ${expected.LABEL ?? expected.name}, received ${actual.image || 'end of file'}`;
	},
	buildNotAllInputParsedMessage({ firstRedundant }): string {
		return `Unexpected token ${firstRedundant.image}`;
	},
	buildNoViableAltMessage({ actual }): string {
		return `Unexpected token ${actual[0]?.image ?? 'end of file'}`;
	},
	buildEarlyExitMessage({ actual }): string {
		return `Expected another item before ${actual[0]?.image ?? 'end of file'}`;
	},
};

export class ViruneParser extends CstParser {
	public constructor() {
		super(allTokens, { recoveryEnabled: true, nodeLocationTracking: 'full', errorMessageProvider: errorProvider });
		const $ = this;

		$.RULE('module', () => {
			$.MANY(() => $.CONSUME(NewLine));
			$.OPTION(() => {
				$.CONSUME(KwUnsafe);
				$.CONSUME(KwModule);
				$.SUBRULE($.lineEnd);
				$.MANY6(() => $.CONSUME4(NewLine));
			});
			$.MANY2(() => {
				$.SUBRULE($.importDeclaration);
				$.MANY3(() => $.CONSUME2(NewLine));
			});
			$.MANY4(() => {
				$.SUBRULE($.declaration);
				$.MANY5(() => $.CONSUME3(NewLine));
			});
		});

		$.RULE('importDeclaration', () => {
			$.OPTION(() => $.CONSUME(KwPub));
			$.CONSUME(KwImport);
			$.OPTION2(() => $.CONSUME(KwJs));
			$.OPTION3(() => $.CONSUME(KwType));
			$.OR([
				{ GATE: () => this.LA(1).tokenType === StringLiteral, ALT: () => $.CONSUME(StringLiteral) },
				{ GATE: () => this.LA(1).tokenType === LBrace, ALT: () => {
					$.CONSUME(LBrace);
					$.MANY(() => $.CONSUME(NewLine));
					$.OPTION4(() => {
						$.SUBRULE($.importItem);
						$.MANY2(() => {
							$.CONSUME(Comma);
							$.MANY3(() => $.CONSUME2(NewLine));
							$.OPTION5(() => $.SUBRULE2($.importItem));
						});
					});
					$.CONSUME(RBrace);
					$.CONSUME(KwFrom);
					$.CONSUME2(StringLiteral);
				} },
				{ GATE: () => this.LA(1).tokenType === Star, ALT: () => {
					$.CONSUME(Star);
					$.CONSUME(KwAs);
					$.CONSUME(Identifier);
					$.CONSUME2(KwFrom);
					$.CONSUME3(StringLiteral);
				} },
				{ ALT: () => {
					$.CONSUME2(Identifier);
					$.CONSUME3(KwFrom);
					$.CONSUME4(StringLiteral);
				} },
			]);
			$.SUBRULE($.lineEnd);
		});

		$.RULE('importItem', () => {
			$.CONSUME(Identifier);
			$.OPTION(() => {
				$.CONSUME(KwAs);
				$.CONSUME2(Identifier);
			});
		});

		$.RULE('declaration', () => {
			$.MANY(() => $.SUBRULE($.attribute));
			$.OR([
				{ GATE: () => this.isFunctionStart(), ALT: () => $.SUBRULE($.functionDeclaration) },
				{ GATE: () => this.isRecordStart(), ALT: () => $.SUBRULE($.recordDeclaration) },
				{ GATE: () => this.isEnumStart(), ALT: () => $.SUBRULE($.enumDeclaration) },
				{ GATE: () => this.isNewtypeStart(), ALT: () => $.SUBRULE($.newtypeDeclaration) },
				{ GATE: () => this.isTypeAliasStart(), ALT: () => $.SUBRULE($.typeAliasDeclaration) },
				{ GATE: () => this.isExternStart(), ALT: () => $.SUBRULE($.externDeclaration) },
				{ GATE: () => this.isTestStart(), ALT: () => $.SUBRULE($.testDeclaration) },
				{ ALT: () => $.SUBRULE($.topLevelLetDeclaration) },
			]);
		});

		$.RULE('attribute', () => {
			$.CONSUME(At);
			$.CONSUME(Identifier);
			$.OPTION(() => {
				$.CONSUME(LParen);
				$.OPTION2(() => $.SUBRULE($.argumentList));
				$.CONSUME(RParen);
			});
			$.MANY(() => $.CONSUME(NewLine));
		});

		$.RULE('functionDeclaration', () => {
			$.OPTION(() => $.CONSUME(KwPub));
			$.OPTION2(() => $.CONSUME(KwAsync));
			$.CONSUME(KwFn);
			$.CONSUME(Identifier);
			$.OPTION3(() => $.SUBRULE($.typeParameters));
			$.CONSUME(LParen);
			$.MANY(() => $.CONSUME(NewLine));
			$.OPTION4(() => $.SUBRULE($.parameterList));
			$.MANY2(() => $.CONSUME2(NewLine));
			$.CONSUME(RParen);
			$.OPTION5(() => {
				$.CONSUME(ThinArrow);
				$.SUBRULE($.typeReference);
			});
			$.OPTION6(() => $.SUBRULE($.usesClause));
			$.OR([
				{ ALT: () => $.SUBRULE($.block) },
				{ ALT: () => { $.CONSUME(FatArrow); $.SUBRULE($.expression); $.SUBRULE($.lineEnd); } },
			]);
		});

		$.RULE('typeParameters', () => {
			$.CONSUME(Less);
			$.CONSUME(Identifier);
			$.MANY(() => { $.CONSUME(Comma); $.CONSUME2(Identifier); });
			$.CONSUME(Greater);
		});

		$.RULE('parameterList', () => {
			$.SUBRULE($.parameter);
			$.MANY(() => {
				$.CONSUME(Comma);
				$.MANY2(() => $.CONSUME(NewLine));
				$.OPTION(() => $.SUBRULE2($.parameter));
			});
		});

		$.RULE('parameter', () => {
			$.CONSUME(Identifier);
			$.OPTION(() => $.CONSUME(Question));
			$.CONSUME(Colon);
			$.SUBRULE($.typeReference);
		});

		$.RULE('usesClause', () => {
			$.CONSUME(KwUses);
			$.OR([
				{ ALT: () => $.CONSUME(Identifier) },
				{ ALT: () => $.CONSUME(Star) },
			]);
			$.MANY(() => {
				$.CONSUME(Comma);
				$.OR2([
					{ ALT: () => $.CONSUME2(Identifier) },
					{ ALT: () => $.CONSUME2(Star) },
				]);
			});
		});

		$.RULE('recordDeclaration', () => {
			$.OPTION(() => $.CONSUME(KwPub));
			$.CONSUME(KwRecord);
			$.CONSUME(Identifier);
			$.OPTION2(() => $.SUBRULE($.typeParameters));
			$.OPTION3(() => $.SUBRULE($.derivesClause));
			$.CONSUME(LBrace);
			$.MANY(() => $.CONSUME(NewLine));
			$.MANY2(() => {
				$.SUBRULE($.recordField);
				$.MANY3(() => $.CONSUME2(NewLine));
			});
			$.CONSUME(RBrace);
		});

		$.RULE('recordField', () => {
			$.MANY(() => $.SUBRULE($.attribute));
			$.CONSUME(Identifier);
			$.CONSUME(Colon);
			$.SUBRULE($.typeReference);
			$.OPTION(() => $.CONSUME(Comma));
		});

		$.RULE('derivesClause', () => {
			$.CONSUME(KwDerives);
			$.CONSUME(Identifier);
			$.MANY(() => { $.CONSUME(Comma); $.CONSUME2(Identifier); });
		});

		$.RULE('enumDeclaration', () => {
			$.OPTION(() => $.CONSUME(KwPub));
			$.CONSUME(KwEnum);
			$.CONSUME(Identifier);
			$.OPTION2(() => $.SUBRULE($.typeParameters));
			$.OPTION3(() => $.SUBRULE($.derivesClause));
			$.CONSUME(LBrace);
			$.MANY(() => $.CONSUME(NewLine));
			$.MANY2(() => {
				$.SUBRULE($.enumVariant);
				$.MANY3(() => $.CONSUME2(NewLine));
			});
			$.CONSUME(RBrace);
		});

		$.RULE('enumVariant', () => {
			$.CONSUME(Identifier);
			$.OPTION(() => {
				$.CONSUME(LParen);
				$.OPTION2(() => {
					$.SUBRULE($.typeReference);
					$.MANY(() => { $.CONSUME(Comma); $.SUBRULE2($.typeReference); });
				});
				$.CONSUME(RParen);
			});
			$.OPTION3(() => $.CONSUME2(Comma));
		});

		$.RULE('newtypeDeclaration', () => {
			$.OPTION(() => $.CONSUME(KwPub));
			$.CONSUME(KwNewtype);
			$.CONSUME(Identifier);
			$.CONSUME(Equals);
			$.SUBRULE($.typeReference);
			$.SUBRULE($.lineEnd);
		});

		$.RULE('typeAliasDeclaration', () => {
			$.OPTION(() => $.CONSUME(KwPub));
			$.CONSUME(KwType);
			$.CONSUME(Identifier);
			$.OPTION2(() => $.SUBRULE($.typeParameters));
			$.CONSUME(Equals);
			$.SUBRULE($.typeReference);
			$.SUBRULE($.lineEnd);
		});

		$.RULE('externDeclaration', () => {
			$.OPTION(() => $.CONSUME(KwUnsafe));
			$.CONSUME(KwExtern);
			$.CONSUME(KwJs);
			$.CONSUME(StringLiteral);
			$.CONSUME(LBrace);
			$.MANY(() => $.CONSUME(NewLine));
			$.MANY2(() => { $.SUBRULE($.externFunction); $.MANY3(() => $.CONSUME2(NewLine)); });
			$.CONSUME(RBrace);
		});

		$.RULE('externFunction', () => {
			$.OPTION(() => $.CONSUME(KwAsync));
			$.CONSUME(KwFn);
			$.CONSUME(Identifier);
			$.CONSUME(LParen);
			$.OPTION2(() => $.SUBRULE($.parameterList));
			$.CONSUME(RParen);
			$.CONSUME(ThinArrow);
			$.SUBRULE($.typeReference);
			$.OPTION3(() => $.SUBRULE($.usesClause));
			$.CONSUME(Equals);
			$.CONSUME(StringLiteral);
			$.SUBRULE($.lineEnd);
		});

		$.RULE('testDeclaration', () => {
			$.OPTION(() => $.CONSUME(KwAsync));
			$.CONSUME(KwTest);
			$.CONSUME(StringLiteral);
			$.SUBRULE($.block);
		});

		$.RULE('topLevelLetDeclaration', () => {
			$.OPTION(() => $.CONSUME(KwPub));
			$.OR([
				{ ALT: () => $.CONSUME(KwLet) },
				{ ALT: () => $.CONSUME(KwConst) },
			]);
			$.CONSUME(Identifier);
			$.OPTION2(() => { $.CONSUME(Colon); $.SUBRULE($.typeReference); });
			$.CONSUME(Equals);
			$.SUBRULE($.expression);
			$.SUBRULE($.lineEnd);
		});

		$.RULE('typeReference', () => {
			$.OR([
				{ GATE: () => this.LA(1).tokenType === KwFn || (this.LA(1).tokenType === KwAsync && this.LA(2).tokenType === KwFn), ALT: () => $.SUBRULE($.functionTypeReference) },
				{ GATE: () => this.LA(1).tokenType === LParen, ALT: () => $.SUBRULE($.tupleTypeReference) },
				{ ALT: () => {
					$.CONSUME(Identifier);
					$.OPTION(() => {
						$.CONSUME(Less);
						$.SUBRULE($.typeReference);
						$.MANY(() => { $.CONSUME(Comma); $.SUBRULE2($.typeReference); });
						$.CONSUME(Greater);
					});
				} },
			]);
			$.OPTION2(() => $.CONSUME(Question));
		});

		$.RULE('tupleTypeReference', () => {
			$.CONSUME(LParen);
			$.SUBRULE($.typeReference);
			$.CONSUME(Comma);
			$.SUBRULE2($.typeReference);
			$.MANY(() => { $.CONSUME2(Comma); $.SUBRULE3($.typeReference); });
			$.CONSUME(RParen);
		});

		$.RULE('functionTypeReference', () => {
			$.OPTION(() => $.CONSUME(KwAsync));
			$.CONSUME(KwFn);
			$.CONSUME(LParen);
			$.OPTION2(() => {
				$.SUBRULE($.typeReference);
				$.MANY(() => { $.CONSUME(Comma); $.SUBRULE2($.typeReference); });
			});
			$.CONSUME(RParen);
			$.CONSUME(ThinArrow);
			$.SUBRULE3($.typeReference);
			$.OPTION3(() => $.SUBRULE($.usesClause));
		});

		$.RULE('block', () => {
			$.CONSUME(LBrace);
			$.MANY(() => $.CONSUME(NewLine));
			$.MANY2(() => {
				$.SUBRULE($.statement);
				$.MANY3(() => $.CONSUME2(NewLine));
			});
			$.CONSUME(RBrace);
		});

		$.RULE('statement', () => {
			$.OR([
				{ ALT: () => $.SUBRULE($.letStatement) },
				{ ALT: () => $.SUBRULE($.returnStatement) },
				{ GATE: () => this.LA(1).tokenType === KwIf && this.LA(2).tokenType !== KwAwait, ALT: () => $.SUBRULE($.ifStatement) },
				{ ALT: () => $.SUBRULE($.forStatement) },
				{ ALT: () => $.SUBRULE($.whileStatement) },
				{ ALT: () => $.SUBRULE($.breakStatement) },
				{ ALT: () => $.SUBRULE($.continueStatement) },
				{ ALT: () => $.SUBRULE($.discardStatement) },
				{ ALT: () => $.SUBRULE($.deferStatement) },
				{ GATE: () => this.LA(1).tokenType === Identifier && this.LA(2).tokenType === Equals, ALT: () => $.SUBRULE($.assignmentStatement) },
				{ ALT: () => $.SUBRULE($.expressionStatement) },
			]);
		});

		$.RULE('letStatement', () => {
			$.CONSUME(KwLet);
			$.OPTION(() => $.CONSUME(KwMut));
			$.CONSUME(Identifier);
			$.OPTION2(() => { $.CONSUME(Colon); $.SUBRULE($.typeReference); });
			$.CONSUME(Equals);
			$.SUBRULE($.expression);
			$.SUBRULE($.lineEnd);
		});

		$.RULE('returnStatement', () => {
			$.CONSUME(KwReturn);
			$.OPTION(() => $.SUBRULE($.expression));
			$.SUBRULE($.lineEnd);
		});

		$.RULE('ifStatement', () => {
			$.CONSUME(KwIf);
			$.SUBRULE($.expression);
			$.SUBRULE($.block);
			$.OPTION(() => { $.CONSUME(KwElse); $.OR([{ ALT: () => $.SUBRULE2($.block) }, { ALT: () => $.SUBRULE2($.ifStatement) }]); });
		});

		$.RULE('forStatement', () => {
			$.CONSUME(KwFor);
			$.CONSUME(Identifier);
			$.CONSUME(KwIn);
			$.SUBRULE($.expression);
			$.SUBRULE($.block);
		});

		$.RULE('whileStatement', () => {
			$.CONSUME(KwWhile);
			$.SUBRULE($.expression);
			$.SUBRULE($.block);
		});

		$.RULE('breakStatement', () => {
			$.CONSUME(KwBreak);
			$.SUBRULE($.lineEnd);
		});

		$.RULE('continueStatement', () => {
			$.CONSUME(KwContinue);
			$.SUBRULE($.lineEnd);
		});

		$.RULE('discardStatement', () => {
			$.CONSUME(KwDiscard);
			$.SUBRULE($.expression);
			$.SUBRULE($.lineEnd);
		});

		$.RULE('deferStatement', () => {
			$.CONSUME(KwDefer);
			$.SUBRULE($.expression);
			$.SUBRULE($.lineEnd);
		});

		$.RULE('assignmentStatement', () => {
			$.CONSUME(Identifier);
			$.CONSUME(Equals);
			$.SUBRULE($.expression);
			$.SUBRULE($.lineEnd);
		});

		$.RULE('expressionStatement', () => {
			$.SUBRULE($.expression);
			$.SUBRULE($.lineEnd);
		});

		$.RULE('lineEnd', () => {
			$.AT_LEAST_ONE(() => $.CONSUME(NewLine));
		});

		$.RULE('expression', () => $.SUBRULE($.pipelineExpression));

		$.RULE('pipelineExpression', () => {
			$.SUBRULE($.orExpression);
			$.MANY(() => { $.CONSUME(Pipe); $.SUBRULE2($.orExpression); });
		});

		$.RULE('orExpression', () => {
			$.SUBRULE($.andExpression);
			$.MANY(() => { $.CONSUME(OrOr); $.SUBRULE2($.andExpression); });
		});

		$.RULE('andExpression', () => {
			$.SUBRULE($.equalityExpression);
			$.MANY(() => { $.CONSUME(AndAnd); $.SUBRULE2($.equalityExpression); });
		});

		$.RULE('equalityExpression', () => {
			$.SUBRULE($.comparisonExpression);
			$.MANY(() => { $.OR([{ ALT: () => $.CONSUME(EqualEqual) }, { ALT: () => $.CONSUME(BangEqual) }]); $.SUBRULE2($.comparisonExpression); });
		});

		$.RULE('comparisonExpression', () => {
			$.SUBRULE($.additiveExpression);
			$.MANY(() => { $.OR([{ ALT: () => $.CONSUME(Less) }, { ALT: () => $.CONSUME(LessEqual) }, { ALT: () => $.CONSUME(Greater) }, { ALT: () => $.CONSUME(GreaterEqual) }]); $.SUBRULE2($.additiveExpression); });
		});

		$.RULE('additiveExpression', () => {
			$.SUBRULE($.multiplicativeExpression);
			$.MANY(() => { $.OR([{ ALT: () => $.CONSUME(Plus) }, { ALT: () => $.CONSUME(Minus) }]); $.SUBRULE2($.multiplicativeExpression); });
		});

		$.RULE('multiplicativeExpression', () => {
			$.SUBRULE($.unaryExpression);
			$.MANY(() => { $.OR([{ ALT: () => $.CONSUME(Star) }, { ALT: () => $.CONSUME(Slash) }, { ALT: () => $.CONSUME(Percent) }]); $.SUBRULE2($.unaryExpression); });
		});

		$.RULE('unaryExpression', () => {
			$.OR([
				{ ALT: () => { $.OR2([{ ALT: () => $.CONSUME(Bang) }, { ALT: () => $.CONSUME(Minus) }, { ALT: () => $.CONSUME(KwAwait) }]); $.SUBRULE($.unaryExpression); } },
				{ ALT: () => $.SUBRULE($.postfixExpression) },
			]);
		});

		$.RULE('postfixExpression', () => {
			$.SUBRULE($.primaryExpression);
			$.MANY({
				GATE: () => this.isCallSuffixStart() || [Dot, Question, KwWith].includes(this.LA(1).tokenType),
				DEF: () => {
					$.OR([
						{ GATE: () => this.isCallSuffixStart(), ALT: () => $.SUBRULE($.callSuffix) },
						{ ALT: () => { $.CONSUME(Dot); $.CONSUME(IdentifierName); } },
						{ ALT: () => $.CONSUME(Question) },
						{ ALT: () => { $.CONSUME(KwWith); $.SUBRULE($.recordFieldBlock); } },
					]);
				},
			});
		});

		$.RULE('callSuffix', () => {
			$.OPTION(() => $.SUBRULE($.typeArguments));
			$.CONSUME(LParen);
			$.OPTION2(() => $.SUBRULE($.argumentList));
			$.CONSUME(RParen);
		});

		$.RULE('typeArguments', () => {
			$.CONSUME(Less);
			$.SUBRULE($.typeReference);
			$.MANY(() => { $.CONSUME(Comma); $.SUBRULE2($.typeReference); });
			$.CONSUME(Greater);
		});

		$.RULE('argumentList', () => {
			$.SUBRULE($.expression);
			$.MANY(() => { $.CONSUME(Comma); $.MANY2(() => $.CONSUME(NewLine)); $.OPTION(() => $.SUBRULE2($.expression)); });
		});

		$.RULE('primaryExpression', () => {
			$.OR([
				{ ALT: () => $.CONSUME(StringLiteral) },
				{ ALT: () => $.CONSUME(BigIntLiteral) },
				{ ALT: () => $.CONSUME(FloatLiteral) },
				{ ALT: () => $.CONSUME(IntLiteral) },
				{ ALT: () => $.CONSUME(KwTrue) },
				{ ALT: () => $.CONSUME(KwFalse) },
				{ ALT: () => $.CONSUME(Underscore) },
				{ GATE: () => this.isRecordExpressionStart(), ALT: () => $.SUBRULE($.recordExpression) },
				{ ALT: () => $.CONSUME(Identifier) },
				{ ALT: () => $.SUBRULE($.listExpression) },
				{ ALT: () => $.SUBRULE($.parenthesizedOrTupleExpression) },
				{ ALT: () => $.SUBRULE($.conditionalExpression) },
				{ ALT: () => $.SUBRULE($.matchExpression) },
				{ ALT: () => $.SUBRULE($.lambdaExpression) },
				{ ALT: () => $.SUBRULE($.parallelExpression) },
			]);
		});

		$.RULE('recordExpression', () => {
			$.CONSUME(Identifier);
			$.OPTION(() => $.SUBRULE($.typeArguments));
			$.SUBRULE($.recordFieldBlock);
		});

		$.RULE('recordFieldBlock', () => {
			$.CONSUME(LBrace);
			$.MANY(() => $.CONSUME(NewLine));
			$.OPTION(() => {
				$.SUBRULE($.recordEntry);
				$.MANY2(() => { $.CONSUME(Comma); $.MANY3(() => $.CONSUME2(NewLine)); $.OPTION2(() => $.SUBRULE2($.recordEntry)); });
			});
			$.CONSUME(RBrace);
		});

		$.RULE('recordEntry', () => {
			$.CONSUME(Identifier);
			$.OPTION(() => { $.CONSUME(Colon); $.SUBRULE($.expression); });
		});

		$.RULE('listExpression', () => {
			$.CONSUME(LBracket);
			$.MANY(() => $.CONSUME(NewLine));
			$.OPTION(() => {
				$.SUBRULE($.expression);
				$.MANY2(() => { $.CONSUME(Comma); $.MANY3(() => $.CONSUME2(NewLine)); $.OPTION2(() => $.SUBRULE2($.expression)); });
			});
			$.CONSUME(RBracket);
		});

		$.RULE('parenthesizedOrTupleExpression', () => {
			$.CONSUME(LParen);
			$.SUBRULE($.expression);
			$.OPTION(() => {
				$.CONSUME(Comma);
				$.SUBRULE2($.expression);
				$.MANY(() => { $.CONSUME2(Comma); $.SUBRULE3($.expression); });
			});
			$.CONSUME(RParen);
		});

		$.RULE('conditionalExpression', () => {
			$.CONSUME(KwIf);
			$.SUBRULE($.expression);
			$.CONSUME(KwThen);
			$.SUBRULE2($.expression);
			$.CONSUME(KwElse);
			$.SUBRULE3($.expression);
		});

		$.RULE('matchExpression', () => {
			$.CONSUME(KwMatch);
			$.SUBRULE($.expression);
			$.CONSUME(LBrace);
			$.MANY(() => $.CONSUME(NewLine));
			$.AT_LEAST_ONE(() => { $.SUBRULE($.matchArm); $.MANY2(() => $.CONSUME2(NewLine)); });
			$.CONSUME(RBrace);
		});

		$.RULE('matchArm', () => {
			$.SUBRULE($.pattern);
			$.OPTION(() => { $.CONSUME(KwIf); $.SUBRULE($.expression); });
			$.CONSUME(FatArrow);
			$.SUBRULE2($.expression);
			$.OPTION2(() => $.CONSUME(Comma));
		});

		$.RULE('pattern', () => {
			$.SUBRULE($.orPattern);
		});

		$.RULE('orPattern', () => {
			$.SUBRULE($.primaryPattern);
			$.MANY(() => { $.CONSUME(Bar); $.SUBRULE2($.primaryPattern); });
		});

		$.RULE('primaryPattern', () => {
			$.OR([
				{ ALT: () => $.CONSUME(Underscore) },
				{ GATE: () => this.LA(1).tokenType === IntLiteral && this.LA(2).tokenType === RangeInclusive, ALT: () => $.SUBRULE($.rangePattern) },
				{ ALT: () => $.CONSUME(StringLiteral) },
				{ ALT: () => $.CONSUME(IntLiteral) },
				{ ALT: () => $.CONSUME(KwTrue) },
				{ ALT: () => $.CONSUME(KwFalse) },
				{ ALT: () => $.SUBRULE($.listPattern) },
				{ GATE: () => this.LA(1).tokenType === LParen, ALT: () => $.SUBRULE($.tuplePattern) },
				{ GATE: () => this.LA(1).tokenType === Identifier && this.LA(2).tokenType === LParen, ALT: () => $.SUBRULE($.variantPattern) },
				{ GATE: () => this.LA(1).tokenType === Identifier && this.LA(2).tokenType === LBrace, ALT: () => $.SUBRULE($.recordPattern) },
				{ ALT: () => $.CONSUME(Identifier) },
			]);
		});

		$.RULE('rangePattern', () => {
			$.CONSUME(IntLiteral);
			$.CONSUME(RangeInclusive);
			$.CONSUME2(IntLiteral);
		});

		$.RULE('listPattern', () => {
			$.CONSUME(LBracket);
			$.OPTION(() => {
				$.OR([
					{ GATE: () => this.LA(1).tokenType === Spread, ALT: () => {
						$.CONSUME(Spread);
						$.OR2([{ ALT: () => $.CONSUME(Underscore) }, { ALT: () => $.CONSUME(Identifier) }]);
					} },
					{ ALT: () => {
						$.SUBRULE($.pattern);
						$.MANY({ GATE: () => this.LA(1).tokenType === Comma && this.LA(2).tokenType !== Spread && this.LA(2).tokenType !== RBracket, DEF: () => {
							$.CONSUME(Comma);
							$.SUBRULE2($.pattern);
						} });
						$.OPTION2({ GATE: () => this.LA(1).tokenType === Comma && this.LA(2).tokenType === Spread, DEF: () => {
							$.CONSUME2(Comma);
							$.CONSUME2(Spread);
							$.OR3([{ ALT: () => $.CONSUME2(Underscore) }, { ALT: () => $.CONSUME2(Identifier) }]);
						} });
						$.OPTION3(() => $.CONSUME3(Comma));
					} },
				]);
			});
			$.CONSUME(RBracket);
		});

		$.RULE('tuplePattern', () => {
			$.CONSUME(LParen);
			$.SUBRULE($.pattern);
			$.CONSUME(Comma);
			$.SUBRULE2($.pattern);
			$.MANY(() => { $.CONSUME2(Comma); $.SUBRULE3($.pattern); });
			$.CONSUME(RParen);
		});

		$.RULE('variantPattern', () => {
			$.CONSUME(Identifier);
			$.CONSUME(LParen);
			$.OPTION(() => { $.SUBRULE($.pattern); $.MANY(() => { $.CONSUME(Comma); $.SUBRULE2($.pattern); }); });
			$.CONSUME(RParen);
		});

		$.RULE('recordPattern', () => {
			$.CONSUME(Identifier);
			$.CONSUME(LBrace);
			$.OPTION(() => {
				$.OPTION2(() => {
					$.SUBRULE($.recordPatternField);
					$.MANY(() => { $.CONSUME(Comma); $.OPTION3(() => $.SUBRULE2($.recordPatternField)); });
				});
				$.OPTION4(() => { $.CONSUME(Spread); });
			});
			$.CONSUME(RBrace);
		});

		$.RULE('recordPatternField', () => {
			$.CONSUME(Identifier);
			$.OPTION(() => { $.CONSUME(Colon); $.SUBRULE($.pattern); });
		});

		$.RULE('lambdaExpression', () => {
			$.OPTION(() => $.CONSUME(KwAsync));
			$.CONSUME(KwFn);
			$.CONSUME(LParen);
			$.OPTION2(() => $.SUBRULE($.lambdaParameterList));
			$.CONSUME(RParen);
			$.OPTION3(() => { $.CONSUME(ThinArrow); $.SUBRULE($.typeReference); });
			$.OPTION4(() => $.SUBRULE($.usesClause));
			$.OR([
				{ ALT: () => { $.CONSUME(FatArrow); $.SUBRULE($.expression); } },
				{ ALT: () => $.SUBRULE($.block) },
			]);
		});

		$.RULE('lambdaParameterList', () => {
			$.SUBRULE($.lambdaParameter);
			$.MANY(() => { $.CONSUME(Comma); $.SUBRULE2($.lambdaParameter); });
		});

		$.RULE('lambdaParameter', () => {
			$.CONSUME(Identifier);
			$.OPTION(() => { $.CONSUME(Colon); $.SUBRULE($.typeReference); });
		});

		$.RULE('parallelExpression', () => {
			$.CONSUME(KwParallel);
			$.OPTION(() => $.CONSUME(KwTry));
			$.CONSUME(LBrace);
			$.MANY(() => $.CONSUME(NewLine));
			$.SUBRULE($.parallelEntry);
			$.MANY2(() => { $.CONSUME(Comma); $.MANY3(() => $.CONSUME2(NewLine)); $.OPTION2(() => $.SUBRULE2($.parallelEntry)); });
			$.CONSUME(RBrace);
		});

		$.RULE('parallelEntry', () => {
			$.CONSUME(Identifier);
			$.CONSUME(Colon);
			$.SUBRULE($.expression);
		});

		this.performSelfAnalysis();
	}

	private tokenAt(offset: number): IToken | undefined { return this.LA(offset); }
	private publicFollowIs(type: unknown): boolean { return this.tokenAt(1)?.tokenType === KwPub && this.tokenAt(2)?.tokenType === type; }
	private isCallSuffixStart(): boolean {
		if (this.tokenAt(1)?.tokenType === LParen) return true;
		if (this.tokenAt(1)?.tokenType !== Less) return false;
		const previous = this.LA(0);
		const less = this.tokenAt(1);
		if (previous?.endOffset === undefined || less?.startOffset === undefined || previous.endOffset + 1 !== less.startOffset) return false;
		let depth = 0;
		for (let offset = 1; offset < 128; offset++) {
			const token = this.tokenAt(offset);
			if (token === undefined) return false;
			if (token.tokenType === Less) depth++;
			else if (token.tokenType === Greater) {
				depth--;
				if (depth === 0) return this.tokenAt(offset + 1)?.tokenType === LParen;
			}
		}
		return false;
	}
	private isRecordExpressionStart(): boolean {
		const identifier = this.tokenAt(1);
		if (identifier?.tokenType !== Identifier || !/^[A-Z]/u.test(identifier.image)) return false;
		if (this.tokenAt(2)?.tokenType === LBrace) return true;
		const less = this.tokenAt(2);
		if (less?.tokenType !== Less || identifier.endOffset === undefined || less.startOffset === undefined || identifier.endOffset + 1 !== less.startOffset) return false;
		let depth = 0;
		for (let offset = 2; offset < 128; offset++) {
			const token = this.tokenAt(offset);
			if (token === undefined) return false;
			if (token.tokenType === Less) depth++;
			else if (token.tokenType === Greater) {
				depth--;
				if (depth === 0) return this.tokenAt(offset + 1)?.tokenType === LBrace;
			}
		}
		return false;
	}
	private isFunctionStart(): boolean {
		return this.tokenAt(1)?.tokenType === KwFn || this.tokenAt(1)?.tokenType === KwAsync || this.publicFollowIs(KwFn) || (this.publicFollowIs(KwAsync) && this.tokenAt(3)?.tokenType === KwFn);
	}
	private isRecordStart(): boolean { return this.tokenAt(1)?.tokenType === KwRecord || this.publicFollowIs(KwRecord); }
	private isEnumStart(): boolean { return this.tokenAt(1)?.tokenType === KwEnum || this.publicFollowIs(KwEnum); }
	private isNewtypeStart(): boolean { return this.tokenAt(1)?.tokenType === KwNewtype || this.publicFollowIs(KwNewtype); }
	private isTypeAliasStart(): boolean { return this.tokenAt(1)?.tokenType === KwType || this.publicFollowIs(KwType); }
	private isExternStart(): boolean { return this.tokenAt(1)?.tokenType === KwExtern || (this.tokenAt(1)?.tokenType === KwUnsafe && this.tokenAt(2)?.tokenType === KwExtern); }
	private isTestStart(): boolean { return this.tokenAt(1)?.tokenType === KwTest || (this.tokenAt(1)?.tokenType === KwAsync && this.tokenAt(2)?.tokenType === KwTest); }

	public module!: () => CstNode;
	public importDeclaration!: () => CstNode;
	public importItem!: () => CstNode;
	public declaration!: () => CstNode;
	public attribute!: () => CstNode;
	public functionDeclaration!: () => CstNode;
	public typeParameters!: () => CstNode;
	public parameterList!: () => CstNode;
	public parameter!: () => CstNode;
	public usesClause!: () => CstNode;
	public recordDeclaration!: () => CstNode;
	public recordField!: () => CstNode;
	public derivesClause!: () => CstNode;
	public enumDeclaration!: () => CstNode;
	public enumVariant!: () => CstNode;
	public newtypeDeclaration!: () => CstNode;
	public typeAliasDeclaration!: () => CstNode;
	public externDeclaration!: () => CstNode;
	public externFunction!: () => CstNode;
	public testDeclaration!: () => CstNode;
	public topLevelLetDeclaration!: () => CstNode;
	public typeReference!: () => CstNode;
	public tupleTypeReference!: () => CstNode;
	public functionTypeReference!: () => CstNode;
	public block!: () => CstNode;
	public statement!: () => CstNode;
	public letStatement!: () => CstNode;
	public returnStatement!: () => CstNode;
	public ifStatement!: () => CstNode;
	public forStatement!: () => CstNode;
	public whileStatement!: () => CstNode;
	public breakStatement!: () => CstNode;
	public continueStatement!: () => CstNode;
	public discardStatement!: () => CstNode;
	public deferStatement!: () => CstNode;
	public assignmentStatement!: () => CstNode;
	public expressionStatement!: () => CstNode;
	public lineEnd!: () => CstNode;
	public expression!: () => CstNode;
	public pipelineExpression!: () => CstNode;
	public orExpression!: () => CstNode;
	public andExpression!: () => CstNode;
	public equalityExpression!: () => CstNode;
	public comparisonExpression!: () => CstNode;
	public additiveExpression!: () => CstNode;
	public multiplicativeExpression!: () => CstNode;
	public unaryExpression!: () => CstNode;
	public postfixExpression!: () => CstNode;
	public callSuffix!: () => CstNode;
	public typeArguments!: () => CstNode;
	public argumentList!: () => CstNode;
	public primaryExpression!: () => CstNode;
	public recordExpression!: () => CstNode;
	public recordFieldBlock!: () => CstNode;
	public recordEntry!: () => CstNode;
	public listExpression!: () => CstNode;
	public parenthesizedOrTupleExpression!: () => CstNode;
	public conditionalExpression!: () => CstNode;
	public matchExpression!: () => CstNode;
	public matchArm!: () => CstNode;
	public pattern!: () => CstNode;
	public orPattern!: () => CstNode;
	public primaryPattern!: () => CstNode;
	public rangePattern!: () => CstNode;
	public listPattern!: () => CstNode;
	public tuplePattern!: () => CstNode;
	public variantPattern!: () => CstNode;
	public recordPattern!: () => CstNode;
	public recordPatternField!: () => CstNode;
	public lambdaExpression!: () => CstNode;
	public lambdaParameterList!: () => CstNode;
	public lambdaParameter!: () => CstNode;
	public parallelExpression!: () => CstNode;
	public parallelEntry!: () => CstNode;
}

export interface ParseResult {
	readonly cst: CstNode;
	readonly errors: readonly IRecognitionException[];
}

const parser = new ViruneParser();

export function parse(tokens: readonly IToken[]): ParseResult {
	parser.input = [...tokens];
	const cst = parser.module();
	return { cst, errors: parser.errors };
}

export const baseCstVisitorConstructor = parser.getBaseCstVisitorConstructorWithDefaults();
