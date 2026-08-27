# モジュールとパッケージ

[英語版](modules.md)

## `[module.file]` ファイルモジュール
各`.virune`ファイルは1つのモジュールです。相対`import`では`.virune`拡張子を含め、完全一致で解決します。ディレクトリのインデックス解決や拡張子の推論は行いません。

## `[module.visibility]` 可視性
宣言はデフォルトで非公開です。`pub`を付けるとモジュール外へ公開されます。公開シグネチャに非公開の名前的型を含めることはできません。

## `[module.import]` インポート
通常のインポートは名前付きです。`import type`で指定したインポートは、生成するJavaScriptには出力しません。`pub import`は、インポートした同一性をそのまま再エクスポートします。

## `[module.cycle]` 循環依存
型だけの依存関係を含め、モジュール間の循環依存は拒否します。

## `[module.package]` npmパッケージ
パッケージ解決では`package.json`と、ソース宣言用の`virune`条件を持つ`exports`エントリを使用します。生成するJavaScriptは通常のESMインポート条件を使用します。プラットフォームの制約はコンパイル時に検査します。

## `[module.javascript-target]` JavaScriptターゲット
Virune 1.0のプロジェクトが生成するJavaScriptのターゲットはES2022で、`target: "es2022"`で指定します。それ以外のターゲット値は拒否します。

## プラットフォームでの実行

`[platform.browser-runtime]` `platform: "browser"`を指定したプロジェクトは、ブラウザで読み込めるES2022 ESMを出力し、ブラウザ向けの標準ライブラリアダプターを利用できます。Node.js専用のインポートは拒否します。
