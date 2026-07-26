# Virune v1.0.0-rc.1 リリースリハーサル

[English](release-rehearsal-1.0.0-rc.1.md) | [日本語](release-rehearsal-1.0.0-rc.1_ja.md)

この文書はIssue #35の実行記録です。release candidateはreview済みの`release-candidate/v1.0.0-rc.1` branchから、productionの`Release` workflowを使って公開します。

## Candidate identity

- Version: `1.0.0-rc.1`
- Git tag: `v1.0.0-rc.1`
- Release type: GitHub prerelease
- CLI asset: `virune-1.0.0-rc.1.tgz`
- VSIX asset: `virune-vscode-1.0.0-rc.1.vsix`

## 公開URLからのインストール

```bash
npm install --global https://github.com/yaona807/virune/releases/download/v1.0.0-rc.1/virune-1.0.0-rc.1.tgz
virune --version
```

期待するversion出力:

```text
virune 1.0.0-rc.1
```

## 生成projectの検証

```bash
virune init virune-rc-smoke
cd virune-rc-smoke
npm install
npm run check
npm run build
npm run start
```

生成された`package.json`は、`v1.0.0-rc.1` GitHub Release配下のassetだけを参照する必要があります。

## 完全性とprovenance

release assetをdownloadしたdirectoryで実行します。

```bash
sha256sum --check SHA256SUMS
gh attestation verify virune-1.0.0-rc.1.tgz --repo yaona807/virune
gh attestation verify SBOM.cdx.json --repo yaona807/virune
```

`RELEASE-MANIFEST.json`がschema version 2で、全assetを列挙し、download fileと同一のSHA-256およびbyte lengthを記録していることを確認します。`SBOM.cdx.json`がCycloneDX 1.6で、version `1.0.0-rc.1`を示すことも確認します。

## VS Code検証

cleanなVS Code profileへ`virune-vscode-1.0.0-rc.1.vsix`をinstallします。extension activation、Language Server起動、diagnostics、completion、hover、navigation、formatting、rename、code actionを確認します。

## 失敗・rollbackリハーサル

- `v1.0.0-rc.1`の通常公開を再実行した場合、release assetの不変性により失敗する必要があります。
- 部分公開または誤公開を、通常workflowの再実行で修復してはいけません。
- byte-for-byte修復は、同一asset名と置換前後digest evidenceを要求する手動確認済み`release-repair` workflowだけを使用します。
- 意味的な修正またはasset setの変更には、`v1.0.0-rc.2`のような新versionを使用します。

## Stable昇格判定

`v1.0.0`への昇格には、上記の全検証成功、未解決P0 release defectがないこと、直近Nightlyの成功、rollback／repair evidenceのreview記録を要求します。RC assetは不変のまま保持し、stable releaseへrenameしません。

## 実行結果

candidate公開後に、publication workflow run、release URL、download asset検証、clean install結果、VSIX結果、stable昇格判定をこの文書へ記録します。
