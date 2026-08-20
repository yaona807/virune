# リリースチャンネル

[English](release-channels.md) | [日本語](release-channels_ja.md)

Virune `v1.0.0`は、バージョン付きのGitHub Releasesから配布し、npm Registryへ後から公開しません。npm Registryへ最初に公開する安定版は`v1.1.0`を予定しています。リリース固有の公開、所有権、Trusted Publishing、clean install、public verificationの各ゲートが実装され、すべて成功するまではnpmへの公開を有効にしません。

GitHub Releasesは、stable、prerelease、nightlyのすべてについて公式かつ変更不可の配布先として維持します。

**npm Registry方針:** `v1.0.0`は後追いpublishしません。最初のstableは`v1.1.0`、stableは`latest`、prereleaseは`next`を使用し、nightlyはnpmへpublishしません。

| チャンネル | バージョンとGit tag | GitHub Release成果物 | npm Registry方針 | 互換性 |
|---|---|---|---|---|
| stable | `X.Y.Z` / `vX.Y.Z` | production向けのCLI、内部パッケージ、manifest、checksum、SBOM、attestation、VSIX | 最初に承認されたstable Registry release（`v1.1.0`）から、全npm publication gate成功後に公式package集合を`latest`で公開する | 文書化されたstable APIとバージョン付きABIをSemantic Versioningで管理 |
| next | `X.Y.Z-alpha.N`、`-beta.N`、`-rc.N` / 対応する`v*` tag | stable公開前のfeedback用prerelease成果物 | Registry公開対象release lineの承認済みprereleaseは`next`を使用し、`latest`を更新しない | prerelease間で破壊的変更があり得る |
| nightly | `X.Y.Z-nightly.YYYYMMDD.N` / snapshot公開時の対応する`v*` tag | 自動生成する開発snapshot | 現行方針ではnpm Registryへ公開しない | 互換性保証なし |

現在の`v1.0.0`のinstall commandは、引き続きimmutableなGitHub tagとasset名を指定します。

```bash
npm install --global https://github.com/yaona807/virune/releases/download/v1.0.0/virune-1.0.0.tgz
```

最初のstable npm Registry releaseが実際に公開され、public verification gateが成功した後は、CLIのcanonicalな短いinstall pathを次とします。

```bash
npm install --global virune
```

Public Registry verificationが成功する前に、この短いcommandが利用可能であることをrelease availabilityの根拠にしてはいけません。Repositoryのpublication planは`publicationReady`がfalseの間、fail-closedのまま維持します。

## リリース候補の公開

リリース候補のcommitでは、root manifest、全workspace manifest、Virune内部依存に同一のprerelease versionを指定します。準備PRをマージした後、review済みcommitから`release-candidate/vX.Y.Z-rc.N`というbranchを作成します。productionの`Release` workflowはbranch名とmanifest versionの一致を検証し、stable release gate一式を実行して、一致する不変Git tagを作成します。その後、provenanceとSBOM attestationを生成し、GitHub Releaseをprereleaseとして公開します。

release-candidate branch経路ではstable versionを拒否します。通常のstable GitHub公開では、従来どおり既存の`vX.Y.Z` tagを使用します。どちらの経路も既存Releaseを上書きできません。例外的なbyte置換は、監査付き`release-repair` workflowに限定します。

後続のimplementation sliceでnpm publicationを有効化した後は、prerelease publicationに`next`、stable publicationに`latest`を使用します。同一versionのnpm packageとGitHub Release assetは同じreview済みrelease identityから生成しなければならず、別source headからのnpm publishをrecovery pathとして認めません。

公開URLからのCLI導入、生成projectの`check`／`build`／`run`、clean profileでのVSIX検証、checksum確認、SBOM確認、provenance確認、rollback手順のreviewがすべて成功した場合のみRCをstableへ昇格します。npm publication有効化後は、対応するpublic Registry verificationもrelease完了条件へ加えます。昇格時は新しいstable version commitとtagを使用し、RC assetのrenameや変更は行いません。

stable releaseには[`stable-release-gate_ja.md`](stable-release-gate_ja.md)の全条件を要求します。Runtime ABI importは配布チャンネルとは独立して、`@virune/runtime/v2/index.js`のようなバージョン付きpathを使用します。
