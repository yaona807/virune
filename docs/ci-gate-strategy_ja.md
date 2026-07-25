# CIゲート戦略

[English](ci-gate-strategy.md)

## 目的

ViruneのPull Request CIでは、platform-independentな検証とplatform-sensitiveなsmoke testを分離します。対応OS／Node.js matrixは維持しつつ、metadata検証、TypeScript full build、unit suite、fuzz、conformance、formatter checkを各runnerで重複実行しない構成にします。

## Pull Request CIの責務

### 変更分類

`classify` jobはPull Requestのbase commitとhead commitから変更pathを算出します。

次のいずれかだけが変更されている場合に限り、documentation-onlyとして扱います。

- `README.md`、`CONTRIBUTING.md`、`SECURITY.md`などrepository rootのproject Markdown
- `docs/`配下のMarkdown

変更fileが0件の場合、workflow、package metadata、dependency、source、generated baseline、Markdown以外のdocumentation assetが含まれる場合は、常にfull gateを選択します。

Pushと手動実行では常にfull gateを選択します。

### Metadataとpolicy

Ubuntu 24.04／Node.js 24の`metadata` jobだけが`npm run verify:metadata`を実行します。runtime要件、registry設定、workflow policy、CI policy、TypeScript API境界、documentation、release metadata、public API／ABI snapshot、release gate、language grammarを検証します。

Documentation-only Pull Requestでは、追加でdocumentation exampleをbuild・実行します。この経路ではその他のjobをskipします。

### Platform-independent core

Ubuntu 24.04／Node.js 24の`verify` jobが次を担当します。

- project reference buildとtype check
- browser runtimeを除くunit／integration test
- TypeScript binding corpus
- fuzz／semantic differential fuzz smoke suite
- language server／VS Code test
- conformance／formatter check
- source clone smoke test

完全なcore gateが成功した後だけ、jobはcompiled `dist` treeを短期artifactとしてpackageします。

### Platform-sensitive compatibility

Windows Server 2022、Windows Server 2025、macOS 14、Ubuntu Node.js 26は、信頼済みUbuntu core jobが生成したcompiled-output artifactをdownloadします。Native／platform固有dependencyを対象runnerへinstallするため、各jobは引き続きローカルで`npm ci`を実行します。

Compatibility jobは、OS、filesystem、path処理、process生成、Node.js version、VS Code host、CLI実行に依存する可能性があるtestだけを実行します。

- platform smoke test
- language server／VS Code test
- conformance path smoke
- clone／process smoke

Metadata検証、type check、全unit suite、binding corpus、fuzz、formatter検証は重複実行しません。

### Browserとrelease

Browser jobは同じ成功済みcore buildをrestoreし、Chromiumでemitted ESMを実行します。

Release-artifacts jobはmetadata、core、compatibility、browserの全jobが成功した場合だけ実行します。公開判断にPR build artifactを流用せず、cleanなproduction release buildとrelease smoke verificationを実行します。

## Artifactとcacheの安全性

Compiled-output artifactは現在のworkflow runに限定され、commit SHAを含む名前を使用します。Downstream jobはcross-run identifierを指定せず`actions/download-artifact`を使用するため、別Pull Requestまたは過去runのartifactを取得できません。

Artifactに含めるのはrepositoryが生成した`dist` directoryだけです。`node_modules`、credential、cache、package manager state、release candidateは含めません。

各runnerはcommit済みlockfileから`npm ci`を実行します。npm cacheはinstall用download cacheとしてだけ使用し、build outputやrelease証跡として扱いません。

Release packagingはclean checkoutとinstall後に必ずsourceからrebuildします。

## 観測性と再現方法

Wrapperを通した各CI commandは、command、duration、exit status、OS、Node.js version、local reproduction commandを含むJSON timing recordを保存します。Job summaryには遅いcommandから順番に表示します。

失敗時はstdout／stderrを`.cache/ci-failures/`へ保持し、timing evidenceとともにuploadします。Local reproduction commandはGitHub annotationにも出力します。

代表的なcommandは次のとおりです。

```bash
npm run verify:metadata
npm run check
npm run test:core:built -- --failure-output-only
npm run test:platform-smoke:built
npm run test:vscode:built
npm run test:conformance:built
npm run smoke:clone:built
```

## Nightlyの責務

Pull Request CIでは時間を制限したfuzz smoke suiteと、対応platform matrixの完全な検証を行います。Nightly workflowは、長時間fuzz、mutation campaign、performanceの反復計測、ecosystem drift checkなど、即時のPull Request feedbackには不要な高コスト検証を担当します。

Nightly failureを無条件retryで隠してはいけません。再現証跡を保持し、原因となる問題を解決済みとする前にregression testへ昇格させます。
