# セルフホスティングFrontend

[English](self-hosting-frontend.md)

Virune製Frontendは、縦断MVPから境界を限定したマージ可能な段階に分けて拡張します。最初の段階では、`selfhost/mvp/src/frontend-model.virune`と`frontend-lexer.virune`に完全な字句contractを追加します。Production Compiler経路からは引き続き隔離します。

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

## Documentation comment

Commentは破棄しません。`//!`と、正確に3本のslashで始まる`///`を、ordinaryな`//`／`////`とは別に分類します。Markerと、その直後にある最大1個のASCII spaceを除去し、正規化textと完全なsource spanを保持します。次のFrontend段階でParserが宣言へ関連付けます。

## 検証

通常のStage 0 Self-host testで次を検証します。

- 決定的なtoken output
- keyword、literal、operatorの完全なvocabulary
- documentation comment分類
- CRLF position tracking
- soft-line normalization
- malformed literalと予約文字のdiagnostic
- lexical rejection codeおよび開始位置のLegacy Compilerとの一致

この段階ではgrammar、Production Parser、stable Compiler API、Runtime ABI、Interop ABI、公開standard libraryを変更しません。
