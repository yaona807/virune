# 字句構造

[English](lexical.md) | [日本語](lexical_ja.md)

## `[lexical.encoding]` UTF-8
ViruneソースはUTF-8です。識別子はASCII英字・数字・underscoreを使用し、数字から開始できません。`$`はコンパイラ生成識別子用に予約します。

## `[lexical.comments]` コメント
`//`は行コメント、`///`はドキュメントコメントです。Virune 1.0にblock commentはありません。

## `[lexical.statement-end]` 文の終端
セミコロンはtokenではありません。hard line breakが文を終了します。丸括弧・角括弧内、comma後、継続演算子に隣接する改行はsoftです。最終レイアウトは正式formatterが決定します。

## `[lexical.string]` 文字列
文字列はdouble quoteを使用します。補間は`{expression}`、literal braceは`{{`と`}}`です。APIが明示しない限り、文字列操作はUnicode code point単位です。

## `[lexical.number]` 数値
`Int`リテラルはJavaScript safe integerの範囲内でなければなりません。`BigInt`は末尾に`n`を付けます。`Float`はIEEE 754 binary64です。数値型間の暗黙変換はありません。
