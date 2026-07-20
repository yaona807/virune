# ModuleとPackage

[English](modules.md) | [日本語](modules_ja.md)

## `[module.file]` File module
各`.virune`ファイルが1つのmoduleです。相対importは`.virune`拡張子を含み、完全一致で解決します。directory indexや拡張子推論は行いません。

## `[module.visibility]` 可視性
宣言はデフォルトでprivateです。`pub`でmodule外へ公開します。公開signatureにprivate nominal typeを含められません。

## `[module.import]` Import
Importはnamed importです。`import type`は生成JavaScriptから消えます。`pub import`はimportした同一性をre-exportします。default importとwildcard namespace importは1.0に含みません。

## `[module.cycle]` Cycle
Type-onlyを含むmodule dependency cycleを拒否します。

## `[module.package]` npm package
package解決では`package.json`と、source declaration用`virune`条件を持つ`exports`を使用します。生成JavaScriptは通常のESM import条件を使用します。platform制約はコンパイル時に検査します。

## `[module.api]` 公開API snapshot
`virune api`は決定的な公開interface snapshotを生成します。`virune api --check`はdriftを拒否します。source、Runtime ABI、behavior、formatter互換性は別々に管理します。

## Platform実行

`[platform.browser-runtime]` `platform: "browser"`のprojectはbrowserで読み込めるES2022 ESMを出力し、browser標準adapterを利用できます。Node専用importは拒否します。リリース適合試験では実Chromiumで生成moduleを実行し、Runtime ABI import、DOM、非同期module loading、binary valueを確認します。
