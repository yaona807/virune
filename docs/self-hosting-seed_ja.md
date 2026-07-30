# Stage 0セルフホスティングSeed

[English](self-hosting-seed.md)

Stage 0 Seedは、将来のVirune製Compiler Kernelをbootstrapするためのreview済みTypeScript Compiler artifactです。これは固定された信頼起点であり、追従更新される依存関係でも、Production Compilerを選択する仕組みでもありません。

## 固定するSeed

machine-readableなmanifestは[`../.github/self-hosting/stage0-seed.json`](../.github/self-hosting/stage0-seed.json)であり、[`../.github/self-hosting/stage0-seed.schema.json`](../.github/self-hosting/stage0-seed.schema.json)に対して検証します。

初期Seedは次の値へ固定します。

- Virune version／language version：`1.0.0`／`1.0`
- immutable release tag／commit：`v1.0.0`／`dcaf89b2f557fde38cdfd9bceb7d23af3ba8ed51`
- Compiler asset：`virune-compiler-1.0.0.tgz`
- SHA-256：`69c9d54a925377a2331ba39a229ab5809d946eef54bc43a5f14601eafd87d7b4`
- byte size：`143161`
- Node.js baseline：`24.0.0`、package engine：`>=24.0.0`
- Runtime ABI／Interop ABI：`2`／`2`
- normalized artifact policy：`1`

asset identityとchecksumは、commit済みのv1.0.0公開検証記録を根拠にします。Releaseはartifactを再buildせずに復旧され、完全な再検証も成功しています。manifestには公開検証runと復旧runの両方を記録します。

## Clean environmentでの検証

必要条件は次のとおりです。

- Node.js 24以降
- `PATH`上の`tar`
- artifactがcacheにない場合はGitHub ReleaseへのHTTPS接続

次を実行します。

```bash
npm run selfhost:seed:verify
```

commandは固定Compiler assetが存在しない場合に`.cache/selfhost-seed/`へdownloadし、次を検証します。

1. manifest構造、version、baseline、手動更新policy
2. commit済みrelease verification記録とのrelease tag、commit、asset名、byte size、SHA-256の一致
3. downloadしたartifactのbyte sizeとSHA-256
4. tarball内の`package/package.json`にあるpackage名、version、module type、Node.js engine、正確な`@virune/runtime`依存version
5. Seed manifestを自動書換えできるpackage scriptまたはGitHub Actions workflowが存在しないこと

既に取得済みのassetをnetworkなしで検証する場合は次を実行します。

```bash
npm run selfhost:seed:verify -- --artifact /absolute/path/to/virune-compiler-1.0.0.tgz
```

machine-readableな成功結果には`--json`を使用します。検証はfail-closedです。file欠損、HTTP失敗、予期しないmetadata、size差分、checksum差分、version不一致、ABI不一致、自動更新経路を検出した場合は、すべて非0で終了します。

## 更新policy

Seedは最新Releaseへ自動追従しません。更新には、1つのreview対象Pull Request内で次をすべて満たす必要があります。

1. 信頼起点を変更する理由を記載した専用Issue
2. stable、immutable、公開検証済みのRelease asset
3. release evidence、manifest値、review記録の更新
4. asset名、取得元URL、release commit、byte size、SHA-256、Node.js baseline、ABI version、normalized artifact policyの明示review
5. missing、tampered、metadata mismatch、version mismatch、ABI mismatch、自動更新禁止のtest成功
6. repository quality、API、ABI、security、reproducibility gateの成功

`selfhost:seed:update` commandは意図的に存在させず、manifestを書き換える権限を持つworkflowも追加しません。新しいReleaseが存在すること自体は、Stage 0を変更する承認になりません。

## Scope境界

このSeed定義はStage 1／Stage 2を生成せず、通常の`virune` commandでSelf-host Compilerを選択せず、stable Compiler APIを変更せず、Runtime ABI v2／Interop ABI v2も変更しません。これらの移行には後続のSelf-hosting gateが必要です。
