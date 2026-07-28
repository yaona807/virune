# Virune v1.0.0-rc.2 リリースリハーサル

[English](release-rehearsal-1.0.0-rc.2.md) | [日本語](release-rehearsal-1.0.0-rc.2_ja.md)

この文書はIssue #61の実行記録です。release candidateはreview済みの`main` commitから準備し、`release-candidate/v1.0.0-rc.2`をproductionの`Release` workflowで公開しました。

## Candidate identity

- Version: `1.0.0-rc.2`
- Git tag: `v1.0.0-rc.2`
- Tag commit: `3a6698ed9003f1d9e3324736cb2c100b6aa0609a`
- Release type: GitHub prerelease
- Release URL: `https://github.com/yaona807/virune/releases/tag/v1.0.0-rc.2`
- 公開日時: `2026-07-28T14:56:36Z`
- CLI asset: `virune-1.0.0-rc.2.tgz`
- VSIX asset: `virune-vscode-1.0.0-rc.2.vsix`

## rc.1以降に検証した変更

- 安定diagnostic codeとschema version付きJSON diagnostic
- Compiler APIとLSP diagnosticの整合
- Chevrotain 13とdiagnostic span invariantの正規化
- 全locked dependencyの監査とGitHub Dependency Review
- security workflowとleast-privilege hardening

## 公開URLからの導入

```bash
npm install --global https://github.com/yaona807/virune/releases/download/v1.0.0-rc.2/virune-1.0.0-rc.2.tgz
virune --version
```

検証済みversion出力:

```text
virune 1.0.0-rc.2
```

生成projectは`v1.0.0-rc.2`配下のassetだけを参照しました。dependency install、`check`、`build`、`start`はすべて成功しました。

## 完全性、provenance、VS Code検証

Public verificationは公開済み15 assetをすべてdownloadし、`RELEASE-MANIFEST.json` schema version 2に対してbyte lengthとSHA-256 digestを確認しました。CycloneDX 1.6 SBOMは382 componentを含み、provenanceとCycloneDX attestationは成功しました。

公開済み`virune-vscode-1.0.0-rc.2.vsix`は、clean profileでのinstall、activation、Language Server起動、uninstallに成功しました。

Machine-readable public verification recordは、`release-verification/v1.0.0-rc.2` branchの`.github/release-verification/v1.0.0-rc.2.json`に保持しています。

## 実行結果

| 検証 | 結果 | Evidence |
| --- | --- | --- |
| 準備Pull Request | 成功・squash merge済み | PR #62 / commit `3a6698ed9003f1d9e3324736cb2c100b6aa0609a` |
| CI | 成功 | run `338` |
| Nightly quality suites | 成功 | run `60` |
| Release dry run | 成功 | run `182` |
| CodeQL | 成功 | run `159` |
| Dependency Reviewとruleset compatibility context | 成功 | run `142` |
| Browser conformance | 成功 | run `148` |
| VSIX smoke | 成功 | run `144` |
| Performance | 成功 | run `197` |
| TypeScript 7 prototype | 成功 | run `79` |
| Production prerelease公開 | 成功 | release `v1.0.0-rc.2` |
| 公開CLI・生成project検証 | 成功 | `.github/release-verification/v1.0.0-rc.2.json` |
| 公開VSIX検証 | 成功 | `.github/release-verification/v1.0.0-rc.2.json` |
| Provenance・CycloneDX attestation | 成功 | `.github/release-verification/v1.0.0-rc.2.json` |

## Stable昇格判定

release candidateの技術cycleは完了しました。stable `v1.0.0`は別のreview済み意思決定とし、昇格時点で未解決P0／P1 release defectが存在しないことを要求します。RC2 assetは不変のまま保持し、stable releaseへrenameまたは変更しません。
