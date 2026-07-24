# Stableリリースゲート

[English](stable-release-gate.md) | [日本語](stable-release-gate_ja.md)

Viruneを`stable`チャンネルへ昇格できるのは、`.github/stable-release-gate.json`に定義した全要件を満たした場合だけです。

tag起点のRelease workflowと手動のRelease dry-run workflowは、同じ`npm run release:gate`を実行します。このコマンドは`.cache/release/release-evidence.json`を生成し、version、commit、個別check結果、要件とevidenceの対応、所要時間、採用した最新Nightly runを記録します。

機械判定する要件は次を含みます。

- Formatterのcomment anchor、冪等性、regression test、fuzz smoke。
- Node.jsおよびbrowser runtimeにおけるstructured concurrencyのcancelとsettlement。
- Stable Compiler APIとRuntime v2、Interop v2、Stdlibの公開ABI snapshot。
- Normative specificationとgrammarのcoverage。
- clean checkoutからのNode.jsおよびbrowser conformance。
- FFIのUnknown fallback、unsafe boundary、review済みbinding corpus。
- Parser、Formatter、Checker、semantic fuzz suite。
- 公開用package、manifest、checksum、VSIX packaging、offline clean install、生成projectの実行。
- policyで定義した有効期間内に`main`で成功したNightly quality run。

ローカルで構造を確認する場合は次を実行します。

```bash
npm run release:check
npm run abi:check
```

完全なgateでは最新Nightly evidenceを確認するためGitHub Actionsのcredentialが必要です。Actions画面から**Release dry run**を実行してください。stable tagは、tag対象と完全に同じcommitでdry-runが成功するまで作成しません。

意図的なABI変更では`npm run abi:update`でreview対象のsnapshotを更新し、互換性への影響を文書化します。破壊的変更の場合はversion付きABI pathも更新します。
