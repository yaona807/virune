# リリースチャンネル

[English](release-channels.md) | [日本語](release-channels_ja.md)

Viruneは、バージョン付きのGitHub Releasesから配布します。成果物はnpm互換tarballとVS Code VSIXですが、Viruneパッケージをnpm Registryへ公開せず、npm Registryのdist-tagも使用しません。

| チャンネル | バージョンとGit tag | GitHub Release成果物 | 互換性 |
|---|---|---|---|
| stable | `X.Y.Z` / `vX.Y.Z` | production向けのCLI、内部パッケージ、manifest、checksum、SBOM、attestation、VSIX | 文書化されたstable APIとバージョン付きABIをSemantic Versioningで管理 |
| next | `X.Y.Z-alpha.N`、`-beta.N`、`-rc.N` / 対応する`v*` tag | stable公開前のfeedback用prerelease成果物 | prerelease間で破壊的変更があり得る |
| nightly | `X.Y.Z-nightly.YYYYMMDD.N` / snapshot公開時の対応する`v*` tag | 自動生成する開発snapshot | 互換性保証なし |

インストールコマンドでは、具体的なGitHub tagとasset名を指定します。

```bash
npm install --global https://github.com/yaona807/virune/releases/download/v1.0.0/virune-1.0.0.tgz
```

## リリース候補の公開

リリース候補のcommitでは、root manifest、全workspace manifest、Virune内部依存に同一のprerelease versionを指定します。準備PRをマージした後、review済みcommitから`release-candidate/vX.Y.Z-rc.N`というbranchを作成します。productionの`Release` workflowはbranch名とmanifest versionの一致を検証し、stable release gate一式を実行して、一致する不変Git tagを作成します。その後、provenanceとSBOM attestationを生成し、GitHub Releaseをprereleaseとして公開します。

release-candidate branch経路ではstable versionを拒否します。通常のstable公開では、従来どおり既存の`vX.Y.Z` tagを使用します。どちらの経路も既存Releaseを上書きできません。例外的なbyte置換は、監査付き`release-repair` workflowに限定します。

公開URLからのCLI導入、生成projectの`check`／`build`／`run`、clean profileでのVSIX検証、checksum確認、SBOM確認、provenance確認、rollback手順のreviewがすべて成功した場合のみRCをstableへ昇格します。昇格時は新しいstable version commitとtagを使用し、RC assetのrenameや変更は行いません。

stable releaseには[`stable-release-gate_ja.md`](stable-release-gate_ja.md)の全条件を要求します。Runtime ABI importは配布チャンネルとは独立して、`@virune/runtime/v2/index.js`のようなバージョン付きpathを使用します。
