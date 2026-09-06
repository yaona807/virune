# モジュールとパッケージ

[英語版](modules.md)

## `[module.file]` ファイルモジュール
各`.virune`ファイルは1つのモジュールです。相対`import`では`.virune`拡張子を含め、完全一致で解決します。ディレクトリのインデックス解決や拡張子の推論は行いません。

## `[module.visibility]` 可視性
宣言はデフォルトで非公開です。`internal`を付けると、同じパッケージまたはアプリケーションスコープ内の別モジュールから参照できます。`pub`を付けると、公開されるpublic APIになります。

可視性の順序は次のとおりです。

```text
private < internal < public
```

宣言のシグネチャに、その宣言より可視性の低い名前的型を含めることはできません。`pub`シグネチャが参照できるのはpublicな名前的型だけです。`internal`シグネチャはinternalまたはpublicな名前的型を参照できます。privateなシグネチャにはモジュール可視性によるこの制約を課しません。

ルートプロジェクト内のモジュールは、1つのアプリケーション／パッケージスコープを共有します。インストール済みnpmパッケージ内のモジュールは、その具体的なパッケージスコープを共有します。internal可視性はインストール済み依存パッケージからconsumerへは越境せず、未知またはスコープ外のパスをinternalとして推測しません。

`internal`は宣言の可視性修飾子です。`internal import`やinternal再エクスポートは定義しません。同一パッケージ内の兄弟モジュールを実行時にリンクするため、internal宣言のJavaScript bindingをESM exportとして生成する場合がありますが、そのruntime exportによってViruneの公開APIになることはありません。

## `[module.import]` インポート
通常のインポートは名前付きです。`import type`で指定したインポートは、生成するJavaScriptには出力しません。`pub import`は、インポートした同一性をそのまま再エクスポートします。`pub import`で`internal`宣言を公開public APIへ昇格させることはできません。

## `[module.cycle]` 循環依存
型だけの依存関係を含め、モジュール間の循環依存は拒否します。

## `[module.package]` npmパッケージ
パッケージ解決では`package.json`と、ソース宣言用の`virune`条件を持つ`exports`エントリを使用します。生成するJavaScriptは通常のESMインポート条件を使用します。プラットフォームの制約はコンパイル時に検査します。

## `[module.javascript-target]` JavaScriptターゲット
Virune 1.0のプロジェクトが生成するJavaScriptのターゲットはES2022で、`target: "es2022"`で指定します。それ以外のターゲット値は拒否します。

## プラットフォームでの実行

`[platform.browser-runtime]` `platform: "browser"`を指定したプロジェクトは、ブラウザで読み込めるES2022 ESMを出力し、ブラウザ向けの標準ライブラリアダプターを利用できます。Node.js専用のインポートは拒否します。
