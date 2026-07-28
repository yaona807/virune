# Virune v1.0.0-rc.2 リリースリハーサル

[English](release-rehearsal-1.0.0-rc.2.md) | [日本語](release-rehearsal-1.0.0-rc.2_ja.md)

この文書はIssue #61の実行記録です。release candidateはreview済みの`main` commitから準備し、`release-candidate/v1.0.0-rc.2`をproductionの`Release` workflowで公開します。

## Candidate identity

- Version: `1.0.0-rc.2`
- Git tag: `v1.0.0-rc.2`
- Release type: GitHub prerelease
- CLI asset: `virune-1.0.0-rc.2.tgz`
- VSIX asset: `virune-vscode-1.0.0-rc.2.vsix`

## rc.1以降に検証する変更

- 安定diagnostic codeとschema version付きJSON diagnostic
- Compiler APIとLSP diagnosticの整合
- Chevrotain 13とdiagnostic span invariantの正規化
- 全locked dependencyの監査とGitHub Dependency Review
- security workflowとleast-privilege hardening

## 必須検証

準備Pull Requestでは、全required check、最新Nightly、release dry run、再現可能build、package／VSIX smoke、CodeQL、Dependency Reviewを成功させます。

公開後は、不変なrelease assetからCLIをinstallします。

```bash
npm install --global https://github.com/yaona807/virune/releases/download/v1.0.0-rc.2/virune-1.0.0-rc.2.tgz
virune --version
```

Public verificationでは次を確認します。

- `virune --version`が`1.0.0-rc.2`を返すこと
- `virune init`が`v1.0.0-rc.2`配下のassetだけを参照すること
- 生成projectのdependency install、`check`、`build`、`start`
- clean profileでのVSIX installとLanguage Server activation
- `SHA256SUMS`、`RELEASE-MANIFEST.json`、CycloneDX SBOM、provenance attestation
- 公開済みassetが不変であること

## Stable昇格判定

stable `v1.0.0`は別のreview済み意思決定とします。このcandidateの公開検証が成功し、未解決P0／P1 release defectが存在しない場合だけ昇格します。

## 実行結果

Production workflow完了後に、公開結果とpublic verification evidenceを記録します。
