# セルフホスティングFrontend

[English](self-hosting-frontend.md)

Virune製Frontendは、縦断MVPから境界を限定したマージ可能な段階に分けて拡張します。Production Compiler経路からは引き続き隔離します。

## 字句contract

Frontend Lexerは、次を含むcanonical JSONを出力します。

- source position／span付きの正規化token
- ordinary、declaration documentation、module documentation comment
- 安定したlexical diagnostic

Token vocabularyは、Virune 1.0の全keyword、identifier、10進／16進／2進integer、BigInt／Float literal、string、punctuation、operator、物理line end、EOFを対象とします。

## Newline normalization

Lexerはtokenを返す前に、`spec/grammar.ebnf`の規範的なsoft-line規則を適用します。

- 丸括弧または角括弧内のline endを除去する
- continuation operatorに隣接するline endを除去する
- 波括弧ではline endを抑制しない
- top-level generic declarationで`>`の後に必要な例外line endを保持する

CRLFとLFは同じ論理line progressionを生成しつつ、source offsetとspanを保持します。

## Parser core

Parser coreは検証済みLexer JSONを読み取り、canonicalなflat AST arenaを生成します。内部のLexer–Parser呼び出しには非`@jsExport`のJSON関数を使用します。既存MVP pipelineと同様に、JSON textを`Json.parse`してから、そのJSON valueを`FrontendLexResult`として`Json.decode`します。`@jsExport`はHost向けcontractだけに限定します。再帰的なJavaScript object graphではなく、integer IDとchild ID listを使用します。Node IDはappend順で決まるため、同一入力は同一serializationを生成します。

現在のParser基盤には次を含みます。

- module、unsafe module、import、attribute、declaration envelope
- function declarationとnested block
- `let`、`return`、`discard`、`defer`、assignment、loop、conditional statement構造
- precedenceを考慮したbinary expression
- unary、call、field、try、record update postfix構造
- malformed input向けのdepth limitとnewline／declaration synchronization

## 詳細declarationとtype

Record、enum、newtype、type aliasは、独立したVirune製Parser moduleで詳細ASTへ展開します。返却nodeはabsolute IDを用いて既存arenaへ統合するため、統合後も全child referenceが有効です。

詳細declaration sliceは次のnodeを生成します。

- `TypeParameters`と`TypeParameter`
- `RecordBody`と個別の`RecordField`
- `EnumBody`とpayload typeをchildに持つ個別の`EnumVariant`
- newtype／type aliasのunderlying type child
- named、generic、tuple、function、list、optional type reference

Malformedなfield、variant、generic argument、underlying typeは安定したParser diagnosticを生成し、後続declarationへの進行を維持します。未閉鎖のenum payloadによって物理newlineがLexer normalizationで抑制された場合は、source line positionを使い、次variantを消費する前にrecoveryを停止します。

## Match expressionとpattern

`MatchExpression`のtarget、optional guard、arm bodyは、既存のprecedence-aware expression parserでparseします。各armのpatternは独立したVirune製moduleでparseし、absolute arena node IDを持つdata-only JSONとして返します。

Pattern sliceは次のnodeを生成します。

- pattern、optional guard、bodyをchildに持つ`MatchArm`
- wildcard、identifier、literal、inclusive range pattern
- list、tuple、rest pattern
- variant、record、record field、record rest pattern
- alternative pattern向けのcanonicalな`OrPattern`

Pattern nestingには上限を設けています。Malformed patternまたは欠落した`=>`は安定したParser diagnosticを生成し、物理line endまたは囲んでいる`}`で同期します。Progress guardにより、malformed armでParserが停止し続けることを防ぎます。

## Lambda expression

Lambda headerは、独立したVirune製data-only moduleでparseします。Header resultを既存arenaへ統合した後、Parser coreがexpression bodyまたはblock bodyを処理します。

Lambda sliceは次のnodeを生成します。

- sync／asyncの`LambdaExpression`
- `LambdaParameters`と個別の`LambdaParameter`
- optional parameter typeとreturn typeのchild
- `UsesClause`と個別の`EffectName`
- 既存Parser coreを利用したexpression bodyとblock body
- 詳細parenthesized lambda nodeとimmediate lambda-call postfix node

Lambda header内のtype-reference nestingには上限を設けています。Header delimiterまたはbodyの欠落は安定したdiagnosticを生成し、現在のline境界で同期します。Nested lambdaは別の再帰object modelを作らず、同じrecursive expression pathを再利用します。

## Conditional expressionとparallel expression

Conditional expressionはParser coreで直接詳細化します。各`ConditionalExpression`はcondition、consequent、alternateのchildを持ち、nested conditionalも既存のprecedence-aware expression pathを再利用します。

Parallel expressionは次のnodeを生成します。

- `parallel`と`parallel try`に対応する`ParallelExpression`
- nameとexpression childを持つ個別の`ParallelEntry`
- 閉じ波括弧後のcall、field、try postfix詳細node

Entryのcolonが欠落した場合はcomma、物理line end、囲んでいる`}`で同期します。次entryと後続declarationを引き続きparseでき、progress guardによりmalformed entry listでParserが停止し続けることを防ぎます。Parallel execution semantics、closure capture semantics、残るgrammar familyはIssue #96を完了する前の後続sliceで扱います。

## Documentation comment

Commentは破棄しません。`//!`と、正確に3本のslashで始まる`///`を、ordinaryな`//`／`////`とは別に分類します。Markerと、その直後にある最大1個のASCII spaceを除去し、正規化textと完全なsource spanを保持します。

Parserはmodule documentationをmodule nodeへ、declaration documentationを対応可能なdeclaration nodeへ関連付けます。Unsupported、late、unattached groupは既存の`L0010`〜`L0012` diagnosticを生成します。

## 検証

通常のStage 0 Self-host testで次を検証します。

- 決定的なtoken／AST output
- keyword、literal、operatorの完全なvocabulary
- documentation comment分類と関連付け
- CRLF position tracking
- soft-line normalization
- malformed literalと予約文字のdiagnostic
- flat arenaのID／child reference整合性
- record、enum、newtype、type alias、nested type-referenceの詳細node
- guard付きmatch armとnested pattern family
- sync／async lambda、typed parameter、return type、uses clause、両body form、nesting、immediate call
- conditional branch、parallel／parallel try entry、direct postfix構造
- malformed declaration detail／match arm／lambda body／parallel entryから後続functionまでのrecovery
- lexical rejectionと対応済みsource acceptanceのLegacy Compilerとの一致

この作業ではgrammar、Production Parser、stable Compiler API、Runtime ABI、Interop ABI、公開standard libraryを変更しません。


## Aggregate expressionとcall expression

Parser coreはlist item、parenthesized／tuple expression、record entry、call argument、任意のcall type argument、record-update entryをcanonical flat-arena nodeへ詳細化します。Shorthand record entryと明示value entryはchild数で区別でき、callとupdateのcontainerは有効なcanonical node IDだけを参照します。

Comma区切りのrecoveryは次のcomma、closing delimiter、物理line end、または囲んでいるrecord braceで同期します。Virune 1.0 grammarが許可する位置ではtrailing commaを受理し、nested aggregateは同じprecedence-aware expression pathを再利用し、progress guardによりmalformed item listでParserが停止し続けることを防ぎます。Semantic arityとrecord-field validationは後続のType／Effect Checkerで扱います。


### Statement detail AST

Stage 0 frontendはlocal statementをcanonical flat arenaへ詳細化します。`LetStatement`は`LetBinding`とinitializerをchildとして持ち、binding textで`mut`を区別し、任意の型注釈は詳細type-reference childとして接続します。assignmentは`AssignmentTarget`を持ち、`ForStatement`は`ForBinding`、iterable、bodyを保持します。壊れたheaderはlineまたはblock境界で復旧し、Production Parserの選択や公開Compiler契約は変更しません。


### Module prefix AST

Stage 0 frontendは`UnsafeModule`、Virune／JavaScriptの詳細`ImportDeclaration`、`ImportItem`、`ImportSource`、declaration `Attribute`を生成します。Import形式、visibility、type-only modeを決定的に保持し、attribute argument listは既存expression parserを再利用して、attribute IDを対象declarationへ接続します。壊れたmodule prefix構文はlineおよびdeclaration境界で復旧します。


### Executable declaration AST

Functionはmodifier、type parameter、parameter、return type、uses clause、bodyを決定的なchildとして保持します。Block bodyは詳細statement parserを、expression bodyはprecedence parserを再利用します。Testは任意のasync modifierと詳細Blockを持ちます。Top-level `let`／`const`は任意の詳細type referenceを持つ`TopLevelBinding`とinitializer expressionを保持します。Header recoveryは後続declarationへの進行を維持します。
