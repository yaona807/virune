# Virune v1.0.0正式リリース

[English](release-1.0.0.md) | [日本語](release-1.0.0_ja.md)

この文書はIssue #64と、公開検証済み`v1.0.0-rc.2`をVirune初の正式版へ昇格する処理を記録します。

## リリース識別情報

- Version: `1.0.0`
- Git tag: `v1.0.0`
- Release type: stable GitHub Release
- CLI asset: `virune-1.0.0.tgz`
- VSIX asset: `virune-vscode-1.0.0.vsix`
- 昇格元: 公開検証済み`v1.0.0-rc.2`

## 昇格根拠

`v1.0.0-rc.2`の公開とpublic verificationは完了しています。不変なrelease assetに対して、CLI install、生成projectのdependency install、`check`、`build`、`start`、clean profileでのVSIX installとLanguage Server起動、SHA-256 manifest、CycloneDX SBOM、provenance attestationを検証済みです。

正式版へ昇格する時点で、未解決のP0／P1 release defectが存在しないことも要求します。

## 必須検証

正式版準備Pull Requestでは、次を含むすべてのrequired checkを成功させます。

- canonical build、test、formatter、conformance、compatibility check
- release対象commitと完全に一致するNightly quality evidence
- stable Release dry run
- release packageとVSIXのsmoke test
- 独立した再現可能release build
- CodeQLとDependency Review、または全locked dependencyを対象にするblocking audit
- browser conformanceとperformance regression check

Stable release gateは、有効期間内に成功し、`head_sha`がrelease対象commitと完全に一致するNightly evidenceだけを受け入れます。

## 公開手順

1. Review済みの準備Pull Requestを`main`へmergeする。
2. Merge後の`main` commitそのものに対してNightly quality suitesを実行する。
3. 同じcommitでStable Release dry runが成功することを確認する。
4. Review済みcommitへ不変な`v1.0.0`tagを作成する。
5. Production release pathでbuild、attestation、asset公開を行う。
6. 公開CLI、生成project、完全性、provenance、SBOM、VSIXを検証する。
7. 公開結果とpublic verification evidenceを記録してからIssue #64を閉じる。

## 公開版のインストール

不変なrelease assetから正式版CLIをインストールします。

```bash
npm install --global https://github.com/yaona807/virune/releases/download/v1.0.0/virune-1.0.0.tgz
virune --version
```

期待するversion出力:

```text
virune 1.0.0
```

## 実行結果

2026-07-29に公開処理が成功しました。

- Review済みrelease commit: `dcaf89b2f557fde38cdfd9bceb7d23af3ba8ed51`
- 不変なtag: `v1.0.0`。Review済みcommitと完全に一致
- Stable GitHub Release: `https://github.com/yaona807/virune/releases/tag/v1.0.0`
- Production publication run: `30417133795`
- Stable release gate、release evidence upload、build provenance attestation、CycloneDX SBOM attestation、不変なtag作成、GitHub Release公開がすべて成功

公開済みassetを対象としたpublic verification run `30417979118`も成功しました。

- Public GitHub Releaseから必須asset一式をダウンロードして検証
- `SHA256SUMS`、release manifest schema v2、CycloneDX 1.6 SBOMの完全性検証に成功
- Public CLI install後のversion出力は`virune 1.0.0`
- 生成projectは不変な`v1.0.0`release dependencyだけを使用し、`check`、`build`、`start`に成功
- Public assetのprovenance attestationとCycloneDX attestationの検証に成功
- Public VSIXはclean install、activation、Language Server起動、uninstallに成功
- Verification artifact digest: `sha256:0cc2fb2324ccc7461c1b4d2ed042a6e51b74df4464869ab5ab4b11cfb6a21035`
- Machine-readable evidence: `.github/release-verification/v1.0.0.json`

Evidence記録後、一回限りのpublication workflowとstable verification workflowは削除します。通常運用で再利用するRelease、repair、dry-run、prerelease public verification workflowは変更せず保持します。既存のRC1／RC2 releaseも不変のまま保持します。
