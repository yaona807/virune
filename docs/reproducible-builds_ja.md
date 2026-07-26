# 再現可能なリリースbuild

[English](reproducible-builds.md)

Viruneは、同一source treeとlockfileからstable release成果物をbit-for-bitで再生成できることを検証します。

## ローカル検証

検証にはNode.js 24以上、npm、`tar`、`unzip`がcommand path上に必要です。

```bash
npm run verify:reproducible-release
```

Commandは独立した一時workspaceを2つ作成します。それぞれへcleanなsource copyを配置し、`npm ci`と完全な`verify:release`経路を実行します。その後、2つの`release/`ディレクトリにある全fileを比較します。

`SOURCE_DATE_EPOCH`の既定値は`0`です。過去のrelease環境を再現する場合は上書きできます。

```bash
SOURCE_DATE_EPOCH=0 npm run verify:reproducible-release
```

`VIRUNE_KEEP_REPRO_WORKSPACES=1`はローカルで失敗原因を調査するときだけ指定します。通常、一時workspaceはrepository外に作成され、検証後に削除されます。

## 比較対象

Gateは次を検証します。

- fileの存在、種別、size、SHA-256 digest、POSIX mode
- symbolic linkの参照先
- 全npm tarballとVSIXのraw byte
- 全npm tarballとVSIXを展開した完全なfile tree
- release fileおよびarchive展開内容に一時workspace pathが含まれないこと

Archive byteが異なる一方、展開後fileが一致する場合、reportはarchive metadataまたはentry順の差分として分類します。通常はtimestamp、entry order、圧縮metadata、permissionの正規化不足を示します。

## Release integrity file

各releaseには次を含めます。

- `SHA256SUMS`: checksum file自身を除く全公開fileを対象にします。
- `RELEASE-MANIFEST.json`: schema version 2で、file size、SHA-256 digest、SBOM metadata、attestation検証commandを保持します。
- `SBOM.cdx.json`: commit済みnpm lockfileから決定的に生成したCycloneDX 1.6形式のSBOMです。
- `MANIFEST.json`と`VSCODE-MANIFEST.json`: package固有、VSIX固有のintegrity metadataを保持します。

Release directory内のdownload fileを一括検証します。

```bash
sha256sum --check SHA256SUMS
```

一部のassetだけをdownloadした場合は`RELEASE-MANIFEST.json`を確認します。記録されたbyte sizeとSHA-256 digestがローカルfileと一致する必要があります。

## Build provenanceとSBOM attestation

Stable release workflowは、`SHA256SUMS`自身を含むrelease directory内の全fileに対して2種類のGitHub Artifact Attestationを生成します。

1. 各assetをrepository、commit、workflow、runner identityへ結び付けるSLSA build provenance
2. 同じassetを`SBOM.cdx.json`へ結び付けるCycloneDX SBOM attestation

GitHub CLIでassetを検証します。

```bash
gh attestation verify virune-1.0.0.tgz --repo yaona807/virune
```

SBOMとの関連付けを検証する場合はCycloneDX predicateを指定します。

```bash
gh attestation verify virune-1.0.0.tgz \
  --repo yaona807/virune \
  --predicate-type https://cyclonedx.org/bom
```

検証結果には`yaona807/virune`と期待するrelease workflowが表示される必要があります。Checksum、repository identity、subject digest、attestation signatureのいずれかを検証できないassetはinstallしないでください。

## 証跡

証跡は`.cache/reproducible-release/`へ出力します。

- `report.json`にはmachine-readableなbuild情報、archive結果、型付き差分を保存します。
- `summary.md`には人間向けの結果を保存します。
- `build-a.log`と`build-b.log`には独立したinstall／release commandの出力を保存します。
- `artifacts/build-a/`と`artifacts/build-b/`は成果物が一致しない場合だけ保持します。

Nightly workflowはこのdirectoryを`reproducible-release-evidence`としてuploadします。Stable release gateも同じ検証を実行し、証跡とrelease候補fileをrelease dry-run artifactへ含めます。

## Stable assetの不変性

通常のtag起動release workflowは、同じGitHub Releaseが既に存在する場合に停止し、`--clobber`を使用しません。したがって、通常の公開経路からstable assetを置換できません。

例外的なintegrity修復は、手動起動専用の`Release asset repair` workflowへ分離します。`main`からの実行、完全一致する確認文字列、incident理由、`release-repair` environmentが必要です。Repository管理者はGitHub設定で、このenvironmentにrequired reviewerなどのdeployment protectionを設定する必要があります。Workflowは元tagを再buildし、asset名の集合が同一であることを要求し、置換前後のSHA-256 inventoryを記録し、365日保持するaudit artifactをuploadします。新しいprovenanceとSBOM attestationを作成した後にのみbyteを置換します。Assetの追加・削除が必要な場合は、新しいrelease versionを作成します。

## Release要件

2つの独立buildが成功し、生成した全成果物が一致し、SBOMとrelease manifestの検証を通過し、必要な最新quality evidenceが成功しない限りstable releaseを許可しません。暗黙の例外は追加しません。意図的に再現不能なfieldを許容する場合は、対象を狭く限定したpolicy変更、理由の文書化、専用regression testが必要です。
