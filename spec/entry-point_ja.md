# 実行エントリーポイント

[English](entry-point.md) | [日本語](entry-point_ja.md)

この文書は`virune run`が使用する実行エントリーポイント契約を定義します。

## 対象範囲

`[entry.run-only]` エントリーポイント契約は`virune run`でのみ検証します。library build、`virune check`、`virune build`、API snapshot、依存moduleには`main`は不要です。

`[entry.module]` `virune.json`で設定した`entry`ファイルだけを検索します。

## 宣言

`[entry.main]` 実行entry moduleは`main`という関数を1つだけ宣言し、その関数をpublicにする必要があります。

`[entry.non-generic]` `main`は型parameterを持てません。

`[entry.parameters]` `main`は引数なし、または型が正確に`List<String>`の引数を1つ取ります。このListには`virune run`へ渡したproject pathより後のprogram引数が入ります。

`[entry.return]` `main`は`Unit`または任意の適正なerror型`E`を使う`Result<Unit, E>`を返します。

`[entry.async]` `main`は同期・非同期のどちらでも構いません。CLIは結果をawaitしてから終了状態を決定します。

許可される形式：

```virune
pub fn main() -> Unit
pub fn main(args: List<String>) -> Unit
pub fn main() -> Result<Unit, E>
pub fn main(args: List<String>) -> Result<Unit, E>
pub async fn main() -> Unit
pub async fn main(args: List<String>) -> Unit
pub async fn main() -> Result<Unit, E>
pub async fn main(args: List<String>) -> Result<Unit, E>
```

上記はsignature例であり、各宣言には有効なVirune bodyが必要です。

## 終了動作

`[entry.exit]` `Unit`または`Ok(Unit)`で終了コード0、`Err(error)`ではerrorを標準エラーへ出力して終了コード1です。panicまたはasync entryのrejectionは利用者向けmessageを標準エラーへ出力し、終了コード1になります。

`[entry.diagnostic]` `main`の欠落・不正はコンパイラ内部エラーではなくuser program errorです。安定した診断`L5010`～`L5016`を生成し、終了コード1で内部JavaScript stack traceを表示しません。

## Browser module

`[entry.browser]` browser target buildは`main`を自動実行しません。browser applicationは`@jsExport`で関数を公開するか、JavaScript bootstrapから生成ESMをimportします。`main`契約は`virune run`専用です。
