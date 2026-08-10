# Virune feature showcase

[English](README.md) | [日本語](README_ja.md)

このディレクトリは、Virune 1.0の公開surfaceを実際のapplicationとして組み合わせる、実行可能なtask-oriented showcaseです。Nodeとbrowserを別projectに分け、platform設定を明示した構成にしています。

## 今回の最初のlandingで示すもの

Node projectでは、小さなdirectory applicationを通して次を組み合わせます。

- multi-module named import
- `newtype`、`record`、`enum`、`Option`、`Result`によるdomain modeling
- executable boundaryでの明示的な`Console` effect
- `await`と`parallel try`によるasync処理
- `defer`による決定的cleanup
- `List`、`Map`、`Set` collection
- `test.include`から検出されるVirune-native test

Browser projectでは公開browser targetを使用し、repository-wide source checkとの互換性を維持した`@jsExport` entryを提供します。Browser専用APIの実行検証は、専用quality gateであるIssue #81へ意図的に分離します。

## 構成

```text
feature-showcase/
├── node/
│   ├── virune.json
│   └── src/
│       ├── domain.virune
│       ├── collections.virune
│       ├── workflow.virune
│       ├── main.virune
│       └── showcase.spec.virune
└── browser/
    ├── virune.json
    └── src/main.virune
```

## Repositoryから検証する

先にrepositoryのtoolchainをbuildしてから実行します。

```bash
npm run virune -- fmt --check examples/feature-showcase/node
npm run virune -- check examples/feature-showcase/node
npm run virune -- test examples/feature-showcase/node
npm run virune -- build examples/feature-showcase/node
npm run virune -- run examples/feature-showcase/node -- Alice Bob

npm run virune -- fmt --check examples/feature-showcase/browser
npm run virune -- check examples/feature-showcase/browser
npm run virune -- build examples/feature-showcase/browser
```

public API snapshotはCompiler semanticsを変更せず生成できます。

```bash
npm run virune -- api examples/feature-showcase/node --out /tmp/feature-showcase.api
```

## Scope boundary

今回の最初のlandingは意図的に`examples/feature-showcase/**`だけを変更します。Compiler、Runtime、JavaScript interop実装、root package script、CI workflowは変更しません。

Virune 1.0ではnominal constructionは宣言module内に閉じ、exported signatureからimport済みnominal typeを再公開しません。Showcase都合でこの境界を緩めず、公開契約として見える形を維持します。

Issue #78に残るsliceは分離して扱います。checked-in public API snapshotと、safe binding / TypeScript adapter / isolated unsafe FFIの代表例です。実browserでのbrowser-only API executionはfollow-upの品質gateであるIssue #81の責務です。
