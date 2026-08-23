# 実行エントリーポイント

[英語版](entry-point.md)

この文書では、`virune run`が使用する実行エントリーポイントの契約を定めます。

## 対象範囲

`[entry.run-only]` エントリーポイントの契約を検証するのは`virune run`だけです。ライブラリのビルド、`virune check`、`virune build`、APIスナップショット、依存モジュールには`main`宣言は必要ありません。

`[entry.module]` 実行エントリーポイントを探すのは、`virune.json`の`entry`で指定したファイルだけです。

## 宣言

`[entry.main]` 実行エントリーポイントとなるモジュールは、`main`という名前の関数を正確に1つだけ宣言し、その関数を公開しなければなりません。

`[entry.non-generic]` `main`は型パラメーターを宣言できません。

`[entry.parameters]` `main`は引数を取らないか、型が正確に`List<String>`である引数を1つだけ取ります。引数がある場合、そのリストには`virune run`へ渡したプロジェクトのパスより後ろにあるプログラム引数が入ります。

`[entry.return]` `main`は`Unit`、または正しく構成された任意のエラー型`E`を使う`Result<Unit, E>`を返さなければなりません。

`[entry.async]` `main`は同期・非同期のどちらでも構いません。CLIは結果を`await`してからプロセスの終了状態を決定します。

許可される形式は以下です。

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

上記はシグネチャの例であり、各宣言には有効なViruneのbodyが必要です。

## 終了動作

`[entry.exit]` `Unit`または`Ok(Unit)`を返した場合は終了コード0になります。`Err(error)`を返した場合は、エラー値を標準エラーへ出力して終了コード1になります。panicまたは非同期`main`のrejectionでは、利用者向けのメッセージを標準エラーへ出力して終了コード1になります。

`[entry.diagnostic]` `main`の欠落や不正は、コンパイラ内部のエラーではなく利用者のプログラム側のエラーです。安定した診断`L5010`から`L5016`を生成し、終了コード1で終了します。内部のJavaScript stack traceは表示しません。

## ブラウザモジュール

`[entry.browser]` ブラウザ向けのビルドでは`main`を自動実行しません。ブラウザアプリケーションは`@jsExport`で関数を公開するか、JavaScriptのbootstrapモジュールから生成したESMをimportします。`main`の契約は`virune run`専用です。
