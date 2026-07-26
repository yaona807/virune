# Virune v1.0.0-rc.1 リリースリハーサル

[English](release-rehearsal-1.0.0-rc.1.md) | [日本語](release-rehearsal-1.0.0-rc.1_ja.md)

この文書はIssue #35の実行記録です。release candidateはreview済みの`release-candidate/v1.0.0-rc.1` branchから、productionの`Release` workflowを使って公開しました。

## Candidate identity

- Version: `1.0.0-rc.1`
- Git tag: `v1.0.0-rc.1`
- Tag commit: `1d346528485155c545a6cf2e4a24252e791674d5`
- Release type: GitHub prerelease
- Release URL: `https://github.com/yaona807/virune/releases/tag/v1.0.0-rc.1`
- CLI asset: `virune-1.0.0-rc.1.tgz`
- VSIX asset: `virune-vscode-1.0.0-rc.1.vsix`

## 公開URLからのインストール

```bash
npm install --global https://github.com/yaona807/virune/releases/download/v1.0.0-rc.1/virune-1.0.0-rc.1.tgz
virune --version
```

検証済みのversion出力:

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

生成された`package.json`は、`v1.0.0-rc.1` GitHub Release配下のassetだけを参照しました。dependency install、`check`、`build`、`start`はすべて成功しました。

## 完全性とprovenance

公開検証workflowは全公開assetをdownloadし、次を検証しました。

- download byteと`SHA256SUMS`の一致
- `RELEASE-MANIFEST.json`のschema version 2、version、file set、byte length、SHA-256
- CycloneDX 1.6 SBOMのversion identityとmanifest digest
- 全release assetのGitHub build provenance attestation
- `SBOM.cdx.json`のCycloneDX attestation

記録されたSBOMは382 componentを含みます。machine-readable evidenceは専用verification branchの`.github/release-verification/v1.0.0-rc.1.json`へ保持しています。

## VS Code検証

公開済み`virune-vscode-1.0.0-rc.1.vsix`をXvfb上のcleanなVS Code profileへinstallしました。extension install、activation、Language Server起動、uninstallはすべて成功しました。

## 失敗・rollbackリハーサル

全release gate、packaging、provenance、SBOM attestationの成功後、production `Release` workflowから同一versionの通常公開を再実行しました。最終公開stepは既存releaseを次の理由で拒否しました。

```text
Release v1.0.0-rc.1 already exists; release assets are immutable.
```

これにより、通常workflowの再実行では公開済みassetを置換できないことを確認しました。byte-for-byte修復は手動確認済み`release-repair` workflowだけに制限します。意味的な修正またはasset setの変更には、`v1.0.0-rc.2`のような新versionが必要です。

## 実行結果

| 検証 | 結果 | Evidence |
| --- | --- | --- |
| Production RC公開 | 成功 | Release workflow run `30198292259` |
| 公開asset・CLI検証 | 成功 | Public release verification run `30202064774` |
| 公開VSIX clean-profile検証 | 成功 | Public release verification run `30202064774` |
| Provenance・CycloneDX attestation | 成功 | Public release verification run `30202064774` |
| Machine-readable verification record | 成功 | `.github/release-verification/v1.0.0-rc.1.json` |
| 通常再公開の不変性 | 期待どおり拒否され成功 | Release workflow run `30202190907` |

## Stable昇格判定

release candidateの技術リハーサルは完了しました。公開、公開URLからのinstall、生成project実行、asset完全性、SBOM、attestation、VSIX activation、通常再実行時の不変性はすべて成功しています。このIssueではstable `v1.0.0`は作成していません。stable昇格は別の意思決定とし、新たにreviewしたstable version commitとtagを使用します。
