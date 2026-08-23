# モジュールとパッケージ

[英語版](modules.md)

## `[module.file]` ファイルモジュール
各`.virune`ファイルは1つのモジュールです。相対`import`では`.virune`拡張子を含め、完全一致で解決します。ディレクトリのindex解決や拡張子の推論は行いません。

## `[module.visibility]` 可視性
宣言はデフォルトで非公開です。`pub`を付けるとモジュール外へ公開されます。公開シグネチャに非公開の名前的型を含めることはできません。

## `[module.import]` Import
`import`は名前付きimportです。`import type`は生成するJavaScriptから消えます。`pub import`はimportした同一性をそのままre-exportします。default importとwildcard namespace importはVirune 1.0には含まれません。

## `[module.cycle]` 循環依存
型だけの依存関係を含め、モジュール間の循環依存は拒否します。

## `[module.package]` npmパッケージ
パッケージ解決では`package.json`と、ソース宣言用の`virune`条件を持つ`exports`エントリを使用します。生成するJavaScriptは通常のESM import条件を使用します。プラットフォームの制約はコンパイル時に検査します。

## `[module.api]` 公開APIスナップショット
`virune api`は決定的な公開インターフェースのスナップショットを生成します。`virune api --check`はスナップショットとの差異がある場合に失敗します。ソース、Runtime ABI、動作、フォーマッターの互換性はそれぞれ別に管理します。

## プラットフォームでの実行

`[platform.browser-runtime]` `platform: "browser"`を指定したプロジェクトは、ブラウザで読み込めるES2022 ESMを出力し、ブラウザ向けの標準アダプターを利用できます。Node.js専用のimportは拒否します。リリース適合試験では、生成したモジュールを実際のChromiumで実行し、Runtime ABIのimport、DOM、非同期モジュール読み込み、バイナリ値を確認します。
