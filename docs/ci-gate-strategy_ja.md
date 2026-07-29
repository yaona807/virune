# CIゲート戦略

[English](ci-gate-strategy.md)

## 目的

Viruneでは、即時のPull Request検証、必須の再現可能ビルド検証、長時間のNightly suite、明示的なrelease rehearsalを分離します。対応OS／Node.js matrixを維持しつつ、同一Pull Request commitに対するmetadata検証、TypeScript build、semantic fuzz、再現可能release buildの重複を避けます。

責務を移動する場合もworkflow名とrequired check名は維持します。特に`CI`、`Release artifacts`、`Reproducible release required check`、`Reproducible release artifacts`は変更せず、repository Rulesetが既存のcheck contextを失わないようにします。

## Pull Request CIの責務

### 変更分類

`classify` jobはPull Requestのbase commitとhead commitから変更pathを算出します。

次のいずれかだけが変更されている場合に限り、documentation-onlyとして扱います。

- `README.md`、`CONTRIBUTING.md`、`SECURITY.md`などrepository rootのproject Markdown
- `docs/`配下のMarkdown

変更fileが0件の場合、workflow、package metadata、dependency、source、generated baseline、Markdown以外のdocumentation assetが含まれる場合は、常にfull gateを選択します。

Pushと手動CI実行では常にfull gateを選択します。

### Metadataとpolicy

Ubuntu 24.04／Node.js 24の`metadata` jobだけが`npm run verify:metadata`を実行します。runtime要件、registry設定、workflow policy、CI policy、TypeScript API境界、documentation、release metadata、public API／ABI snapshot、release gate、language grammarを検証します。

Documentation-only Pull Requestでは、追加でdocumentation exampleをbuild・実行します。この経路ではその他のjobをskipします。

### Canonical build

Full gateでは、Ubuntu 24.04／Node.js 24の`build` jobをmetadata検証と並列で開始します。このjobだけがPull Request用のproject reference buildとtype checkを実行し、生成した`dist` treeを短期artifactへpackageします。

Core test、compiler quality、semantic fuzz、compatibility、browserの各jobはartifactが利用可能になり次第、互いを待たずに開始します。これによりbuildの重複を除去しつつ、対応platform matrixと時間の長いplatform-independent suiteを直列化しません。

### Platform-independent gate

Canonical buildを使用するUbuntu 24.04／Node.js 24のjobを並列実行します。

- `verify`はbrowser runtimeを除く完全なunit／integration suiteを担当します。
- `quality`はTypeScript binding corpus、時間制限付きfuzz／semantic differential fuzz smoke suite、language server／VS Code test、conformance、formatter check、source clone smoke testを担当します。
- `semantic-fuzz`はPull Request向けに4 shardのsemantic differential fuzzを実行し、各shardへ2分を割り当てます。

Pull Request用semantic-fuzz jobはcanonical compiled-output artifactを使用して`scripts/semantic-fuzz-long.mjs`を実行します。Repositoryをjob内で再buildしません。Regression artifactとCI timing evidenceはshard単位でuploadします。

### Platform-sensitive compatibility

Windows Server 2022、Windows Server 2025、macOS 14、Ubuntu Node.js 26は、canonical build jobが生成したcompiled-output artifactをdownloadします。Native／platform固有dependencyを対象runnerへinstallするため、各jobは引き続きローカルで`npm ci`を実行します。

Compatibility jobは、OS、filesystem、path処理、process生成、Node.js version、VS Code host、CLI実行に依存する可能性があるtestだけを実行します。

- platform smoke test
- language server／VS Code test
- conformance path smoke
- clone／process smoke

Metadata検証、type check、全unit suite、binding corpus、fuzz、formatter検証は重複実行しません。

### Browserとrelease artifact

Browser jobはcanonical buildをrestoreし、core、quality、semantic-fuzz、compatibility testと並列でChromium上のemitted ESMを実行します。

`Release artifacts` jobはmetadata、build、core test、compiler quality、Pull Request semantic fuzz、compatibility、browserの全jobが成功した場合だけ実行します。Pushまたは手動CI実行ではPull Request専用semantic-fuzz jobをskipし、release-artifactsのdependencyはその意図したskipを許可します。公開判断にPull Request build artifactを流用せず、cleanなproduction release buildとrelease smoke verificationを実行します。

## 必須の再現可能release check

`Reproducible release required check`は、workflow名とjob名がrepository Rulesetから参照される可能性があるため、独立したPull Request workflowとして維持します。Documentation以外の変更では`npm run verify:reproducible-release`を実行し、documentation-only変更では同じrequired check contextを維持したまま変更分類後にshort-circuitします。

高コストな独立二重buildを自動実行するPull Request workflowは、このrequired checkだけです。Release dry runは同一Pull Request commitで自動起動しないため、再現可能性を二重計算しません。

## Release dry run

`Release dry run`は明示的に起動する`workflow_dispatch` rehearsalです。公開処理は行わず、quality検証、release package作成、再現可能性検証、install済みVSIX smoke test、対応するNightly evidenceを含むstable release gate全体を実行します。

Rehearsalを明示実行へ変更することで、通常のPull Requestがproduction release pathを二重に起動することを防ぎながら、完全なrelease前検証能力を維持します。公開予定refに対して、release policy、packaging、signing、repair処理を変更した場合、または公開前に実行します。

## Nightlyの責務

`Nightly quality suites`はschedule、関連変更が入った`main`へのpush、手動実行の場合だけ起動します。Pull Requestでは起動しません。

Nightlyは次を担当します。

- 15分のcrash fuzzを4 shard
- 完全なbinding corpus
- 15分のsemantic differential fuzzを4 shard
- 独立した再現可能release build

Pull Requestでは`CI`内の短い4 shard semantic fuzz gateを実行します。これにより即時feedbackの責務を明確にし、長時間campaignをmain branchと定期検証へ限定します。

Nightly failureを無条件retryで隠してはいけません。再現証跡を保持し、原因となる問題を解決済みとする前にregression testへ昇格させます。

## Artifactとcacheの安全性

Compiled-output artifactは現在のworkflow runに限定され、commit SHAを含む名前を使用します。Downstream jobはcross-run identifierを指定せず`actions/download-artifact`を使用するため、別Pull Requestまたは過去runのartifactを取得できません。

Artifactに含めるのはrepositoryが生成した`dist` directoryだけです。`node_modules`、credential、cache、package manager state、release candidateは含めません。

各runnerはcommit済みlockfileから`npm ci`を実行します。npm cacheはinstall用download cacheとしてだけ使用し、build outputやrelease証跡として扱いません。

Release packagingはclean checkoutとinstall後に必ずsourceからrebuildします。

## 観測性と再現方法

Wrapperを通した各CI commandは、command、duration、exit status、OS、Node.js version、local reproduction commandを含むJSON timing recordを保存します。Job summaryには遅いcommandから順番に表示します。

失敗時はstream表示したstdout／stderrを`.cache/ci-failures/`へ保持し、timing evidenceとともにuploadします。Local reproduction commandはGitHub annotationにも出力します。

代表的なcommandは次のとおりです。

```bash
npm run verify:metadata
npm run check
npm run test:core:built -- --failure-output-only
npm run test:binding-corpus:built
node scripts/semantic-fuzz-long.mjs
npm run test:platform-smoke:built
npm run test:vscode:built
npm run test:conformance:built
npm run smoke:clone:built
npm run verify:reproducible-release
npm run release:gate
```
