# Runtime ABI v2

[English](runtime-abi.md)

Virune 1.0.0は、Runtime ABI v2に従うES2022モジュールを出力します。

## ネイティブ表現

- プリミティブ型は、検証済みのJavaScriptプリミティブ表現を使います。
- `record`は、列挙可能なフィールドと列挙不可の名前的`$type` IDを持つ、prototypeなしのオブジェクトです。
- `enum`は、安定したタグ付き集約値を使います。
- `newtype`はコンパイル時の名前的同一性を保ち、実行時には検証済みの基礎表現へ消去します。
- `type` aliasは実行時の同一性を持ちません。
- OptionとResultはRuntimeのコンストラクターとタグを使います。
- ネイティブのList、Map、SetはViruneコードから変更できません。

## 構造的なEqとHash

Runtime ABI v2にはプロトコルレジストリがありません。EqとHashは、対応している不変値に対する固定の構造演算です。名前的な集約IDも比較に含まれるため、形が同じでも別の宣言から作られた値は同一として扱えません。関数、`resource`、Foreign handle（外部ハンドル）、対応していない可変値は、構造比較やHashの対象外です。

コンパイラーが生成する`Eq`と`Hash`はこの固定演算を使います。利用者側のコードで意味を差し替えることはできません。

## Debug

コンパイラーが生成するDebugは、対応している値だけを安定した開発者向け表現へ変換します。明示的に有効化した場合だけ使われ、TypeScriptバインディングには自動生成されません。

## 後始末

`defer`は、現在の関数／タスクのスコープへ後始末を登録します。通常の`return`、早期`return`、`?`による伝播、panic、非同期処理の完了時に、後入れ先出し（LIFO）で実行します。本体側の失敗と後始末中の失敗は、Runtimeのエラー集約契約に従って保持します。

## 構造化並行処理

すべてのタスクはスコープに属します。`parallel`と`parallel try`は現在のスコープで子タスクを開始し、必要な場合は兄弟タスクをキャンセルし、すべての子タスクの状態が確定するまで待ちます。複数の失敗がある場合、報告する失敗はソース上の順序で決まります。Runtimeは、通常のVirune APIを通じて切り離されたタスク（detached task）を公開しません。

## Interop ABI v2の記述子（descriptor）

記述子は、検証済みのプリミティブ型、Option、Result、Bytes、対応しているコレクション、`record`、`enum`、`type` alias、`newtype`を表現します。`record`のフィールドには次の情報を持たせられます。

- 外部JavaScriptでのプロパティ名
- 省略可能なプロパティが欠けた場合に使う`missingAsNone`
- 出力時にプロパティを省略するための`omitWhenNone`
- 境界で期待するnull／undefined表現
- コンパイル時のJSON既定値と厳格性メタデータ

`record`と`enum`の記述子は、完全な名前的`typeId`（`package#module:Type`）を持ちます。再帰または未解決の記述子を暗黙に安全な集約値として扱いません。`Unknown`へフォールバックするか、Adapterを要求します。

安全な記述子は、コールバックの検証、オブジェクトをキーにした任意のJavaScript Map／Set変換、TypeScriptの`Record<K, V>`変換を保証しません。

## JavaScriptへの公開

`@jsExport`のラッパーは入力値を検証し、出力値を変換し、必要な場合は末尾の省略可能な引数を省略します。JavaScriptへ公開するネイティブ集約値は防御的にコピーします。Foreign handleを検証済みのネイティブ値として扱うことはありません。

## 公開ABIスナップショット

`packages/public-abi.snapshot.json`は、Runtime v2、Interop v2、標準ライブラリのエントリーポイントについて、パッケージのexport mapと公開宣言の範囲をレビューできる形で記録します。また、生成JavaScriptがimportするRuntime v2の全シンボルも記録します。

互換性は`npm run abi:check`で確認します。公開シンボルの削除・名前変更・シグネチャ変更、パッケージのexport map変更、Runtime v2の公開範囲外にあるシンボルをEmitterが参照した場合はCIが失敗します。追加だけの変更は削除や変更とは別に報告されますが、それでもレビューと`npm run abi:update`による意図的なスナップショット更新が必要です。

破壊的変更には、新しいバージョン付きABIパスと移行文書が必要です。スナップショットを更新しただけで、破壊的変更が互換になるわけではありません。
