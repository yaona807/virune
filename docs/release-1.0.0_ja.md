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

## 2026-07-30 公開停止インシデントと復旧

Issue #87は、不変なtagと元の公開・public verification evidenceが有効なまま、公開GitHub Releasesページから`v1.0.0`を利用できなくなっていたため作成しました。Repository上の証跡だけでは、誰が、または何がGitHub Releaseの状態を変更したかは特定できません。そのため、具体的な原因は未確認です。このインシデントはrelease bytes、tag、verification evidenceの不具合ではなく、外部のGitHub Release状態変更または削除として記録します。

Artifactを再buildせずにreleaseを復旧しました。

- 不変なtag `v1.0.0`が`dcaf89b2f557fde38cdfd9bceb7d23af3ba8ed51`と完全に一致することを確認
- 元のproduction run `30417133795`からActions artifact `8710597654`、`release-evidence-v1.0.0`を取得
- Retained artifact digest: `sha256:9d9f93d1f4f96328f14cdd0aa72d51d7e41dbfc3b1c347cae9108fefab5cf01a`
- `virune-vscode-1.0.0.vsix`を含むretained assetと公開版から再取得した全assetが、`.github/release-verification/v1.0.0.json`および`SHA256SUMS`に記録されたbyte sizeとSHA-256に一致
- 復旧したpublic assetのprovenance attestationとCycloneDX attestationに成功
- Public CLI install、生成projectの`check`／`build`／`start`、clean profileでのVSIX install、activation、Language Server起動、uninstallに再度成功
- 復旧・再検証run: `30467471246`
- Recovery evidence artifact: `8730226186`、`release-recovery-v1.0.0-30467471246`
- Recovery evidence digest: `sha256:23ac5d74e185777e30b6956f1c6bc6e23603999906243a9263acf3104a9ab19b`

### 復旧手順

`.github/release-recovery/`配下のreview済みfileに、不変なtag、期待commit、元のproduction run、retained artifact ID、artifact名、artifact digest、commit済みverification recordを固定します。`Restore missing stable release` workflowは次を実行します。

1. `main`へmergeされたreview済みrecovery requestを1件だけ受け付ける。
2. Retained Actions artifactのID、run、名前、digestを検証する。
3. 再buildせず、元のproduction artifactをdownloadする。
4. Source asset一式、byte size、SHA-256をcommit済みevidenceと照合する。
5. 不変なtagを検証し、Releaseが存在しなければ作成し、既に存在する場合は冪等に検証を継続する。
6. Public asset一式をdownloadして再検証する。
7. ProvenanceとCycloneDX attestationを検証する。
8. Public CLI、生成project、clean profileのVSIX検証を再実行する。
9. 長期保存するrecovery evidence artifactを作成し、tracking Issueへ結果を記録する。

Workflowは、移動したtag、変更・期限切れのsource artifact、draft／prerelease状態、assetの不足・追加、checksum／size drift、public smokeまたはattestationの失敗を拒否します。これにより、再buildした異なるbytesへの置換を防ぎながら、復旧処理を安全に再実行できます。

元のevidence記録後、一回限りのpublication workflowとstable verification workflowは削除しました。通常運用で再利用するRelease、repair、dry-run、prerelease public verification、evidence-bound recovery workflowは保持します。既存のRC1／RC2 releaseも不変のまま保持します。
