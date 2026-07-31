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

Parser coreは検証済みLexer JSONを読み取り、canonicalなflat AST arenaを生成します。内部のLexer–Parser呼び出しには非`@jsExport`のJSON関数を使用し、JavaScript境界wrapperを介しません。`@jsExport`はHost向けcontractだけに限定します。再帰的なJavaScript object graphではなく、integer IDとchild ID listを使用します。Node IDはappend順で決まるため、同一入力は同一serializationを生成します。

現在のParser基盤には次を含みます。

- module、unsafe module、import、attribute、declaration envelope
- function declarationとnested block
- `let`、`return`、`discard`、`defer`、assignment、loop、conditional statement構造
- precedenceを考慮したbinary expression
- unary、call、field、try、record update postfix構造
- declaration bodyと複雑なexpression form向けのbalanced transport node
- malformed input向けのdepth limitとnewline／declaration synchronization

このcoreは拡張基盤です。Record field、enum variant、pattern、lambda内部、全type-reference formは、Issue #96を完了する前に後続の限定Parser変更で詳細nodeへ展開します。

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
- malformed input後のdeclarationまで到達するParser recovery
- lexical rejectionと対応済みsource acceptanceのLegacy Compilerとの一致

この作業ではgrammar、Production Parser、stable Compiler API、Runtime ABI、Interop ABI、公開standard libraryを変更しません。
