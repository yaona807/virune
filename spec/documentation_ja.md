# ドキュメントコメント

[English](documentation.md) | [日本語](documentation_ja.md)

## `[documentation.kinds]` コメント種別

Viruneは、3種類の行コメントを区別します。

```virune
// 通常コメント
/// 直後の宣言を説明するドキュメントコメント
//! 現在のソースモジュールを説明するドキュメントコメント
```

`///`は、正確に3個のslashの直後が`/`以外である場合だけドキュメントコメントです。`////`は通常の行コメントです。Virune 1.0にblock commentおよびblock documentation commentはありません。

## `[documentation.module]` モジュールドキュメント

連続する`//!`行のグループは、現在のソースモジュールを説明します。import、attribute、宣言、ほかのコメントより前のファイル先頭に記述しなければなりません。先頭の空白と空行は許可します。1つのソースモジュールに記述できるモジュールドキュメントグループは1つだけです。

## `[documentation.declaration]` 宣言ドキュメント

連続する`///`行のグループは、次の対応宣言を説明します。`///`は各行の最初の非空白要素でなければなりません。コメントグループと宣言の間には、空行および宣言attributeを記述できます。通常コメントまたはほかのtokenが存在すると関連付けは終了します。

ドキュメントコメントを付与できる対象は次のとおりです。

- 関数
- recordおよびrecord field
- enumおよびenum variant
- newtypeおよびtype alias
- top-levelの`let`および`const`宣言
- extern blockおよびextern function

import、test、parameter、local variable、statement、expressionには付与できません。関連付けられない、または非対応対象に付与されたドキュメントコメントはcompile errorです。

## `[documentation.normalization]` 本文の正規化

各行からmarkerを除去し、その直後にASCII spaceがある場合は最大1文字だけ除去します。残りの行をLFで連結し、先頭と末尾の空ドキュメント行を除去します。コメントグループ全体のsource spanは保持します。

Formatterは、本文が空でない`///`または`//!`の直後にASCII spaceを1文字挿入します。Markdown本文の自動折り返しは行いません。

## `[documentation.markdown]` Markdown

本文はCommonMark 0.31.2互換Markdownです。公式toolingはraw HTMLを描画しません。最初の段落をsummaryとして補完などのUIで使用し、Hoverおよび生成ドキュメントでは全文を表示できます。

`Parameters`、`Returns`、`Errors`、`Panics`、`Safety`、`Examples`などの見出しは慣例であり、言語構文ではありません。Virune 1.0は、`@param`、`@return`、XML tag、見出し名に特別な意味を与えません。

## `[documentation.semantics]` コンパイル時の意味

ドキュメントは正規化済みtextとしてASTへ保持します。名前解決、型検査、JavaScript出力、Runtime ABI、stable API互換性snapshotには影響しません。

公式editor toolingは、Hover、補完、Signature Help、snippet、ドキュメント生成Code Actionを通じてドキュメントを提供します。

## `[documentation.diagnostics]` 診断

| Code | 条件 |
|---|---|
| `L0010` | `///`グループが対応宣言へ関連付けられていない。 |
| `L0011` | `//!`グループがファイル先頭にない。 |
| `L0012` | `///`グループの対象が非対応構文である。 |
| `L0013` | モジュールまたは宣言に複数のドキュメントグループがある。 |
