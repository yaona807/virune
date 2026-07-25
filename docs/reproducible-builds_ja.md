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

## 証跡

証跡は`.cache/reproducible-release/`へ出力します。

- `report.json`にはmachine-readableなbuild情報、archive結果、型付き差分を保存します。
- `summary.md`には人間向けの結果を保存します。
- `build-a.log`と`build-b.log`には独立したinstall／release commandの出力を保存します。
- `artifacts/build-a/`と`artifacts/build-b/`は成果物が一致しない場合だけ保持します。

Nightly workflowはこのdirectoryを`reproducible-release-evidence`としてuploadします。Stable release gateも同じ検証を実行し、release dry-run artifactへ証跡を含めます。

## Release要件

2つの独立buildが成功し、生成した全成果物が一致しない限りstable releaseを許可しません。暗黙の例外は追加しません。意図的に再現不能なfieldを許容する場合は、対象を狭く限定したpolicy変更、理由の文書化、専用regression testが必要です。
