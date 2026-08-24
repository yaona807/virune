# Self-host昇格観測

[English](self-hosting-promotion-observation.md)

`Self-host promotion observation` workflowは、`required-selfhost`段階の正式な観測元です。特定のPromotion Subjectに対するversion 2観測を1件生成しますが、Compilerの選択や昇格可否そのものは変更しません。

## 正式な観測時計

workflowはdefault branchで1日1回実行し、診断用に手動実行もできます。

正式な観測として数えるのは、次の条件をすべて満たすrunだけです。

- repository: `yaona807/virune`
- workflow file: `.github/workflows/selfhost-promotion-observation.yml`
- ref: `refs/heads/main`
- event: `schedule`
- forkではないrepositoryからの実行

workflowの識別にはGitHub Actionsの`workflow_ref`を使い、repository、workflow file path、refを一体として確認します。表示名はsecurity identityとして使いません。

手動実行でも同じ証拠を生成しますが、観測回数には数えません。各logical GitHub runにはrun ID単位の独立したconcurrency groupを割り当て、`cancel-in-progress: false`とします。これにより、後続のscheduled runやmanual runがpending中の正式観測を置き換えることはありません。run同士のoverlapは意図的に許可し、後続の履歴aggregation側で完了済みの順序付きprefixだけを処理し、in-progress runに到達した時点で停止します。通常の`push`や`pull_request`は正式観測の入力にしません。

観測artifactには、証拠を生成した正確なGit `executionCommit`と、製品そのものを表す`promotionSubjectId`を別々に保持します。

## `required-selfhost`の製品範囲

Promotion Subjectは変更pathやGit commitから推測せず、実際にbuildした製品artifactから作ります。

version 2の`required-selfhost`では、次を製品範囲へ含めます。

- bootstrap artifact正規化policyのbuild済み実装と、その相対module closure
- 検証済みfixed Seed artifactの識別子
- release-core証拠で固定したStage 3 normalized compiler artifact
- version付きで明示したSelf-host Hostの実行・選択境界root集合と、そこから到達するStage 0 project buildのruntime closure
- build済みRuntime artifactとRuntime ABI
- build済みStandard Library artifact

RuntimeとStandard Libraryのpackage surfaceでは、package名とversion、module type、Node engine contract、実行時exports、runtime dependencies、build済み`dist/src` artifact tree全体をbindします。実行時exportの参照先は、bind済み`dist/src` tree内の通常ファイルでなければなりません。tree外のexport、存在しない参照先、symlink参照先は、実行bytesを製品identityの外へ残さないためfail closedで拒否します。runtimeやmodule resolutionへ影響し得るのにまだ明示的にmodel化していない`main`、`module`、`browser`、`imports`、`sideEffects`、optional／peer dependency metadata、`os`／`cpu`／`libc`制約が追加された場合もfail closedで拒否します。documentation／repository metadata、keywords、build script、development-only dependencyは製品identityへ含めませんが、それらがbuild結果へ影響した場合はbind済みartifact bytesの変化として反映されます。

Host componentはCompiler全体や`selfhost` directory全体をhashせず、実行・選択境界を明示した固定root集合として保持します。固定Host rootからの直接runtime importは、別の固定Host root、別componentとしてbind済みのbootstrap policy、Stage 0 project build closure、またはNode built-inのいずれかへ解決されなければなりません。現在のCompilerはLegacy adapterをstatic importしているため、Legacy adapter自体も固定Host rootとしてbindします。Promotion toolingの都合でCompilerのload構造を変更してLegacyを除外しません。新しいimportがこの境界外へ増えた場合は、未追跡dependencyとして黙って受け入れずfail closedで拒否します。

repository moduleではなく生成済みcompiler artifactをloadするため、2つの非literal dynamic loading境界だけをversion付きで明示します。`selfhost/bootstrap-execution-probe.js`はmaterializeしたbootstrap execution candidateを正確に1件だけloadし、Host manifestへ`generated:bootstrap-execution-candidate-v1`として記録します。build済みtarget構築では`entryModulePath`を正規化し、`.js` moduleに限定し、materialize済みcandidate rootの下へ`join`して`pathToFileURL`へ変換し、その`moduleUrl.href`だけをimportします。`selfhost/bootstrap-stage-loader.js`もmaterializeしたStage compiler candidateを正確に1件だけloadし、`generated:bootstrap-stage-compiler-candidate-v1`として記録します。選択したemitted entry moduleをmaterialize済みstage rootの下へ`join`し、file URLへ変換した`moduleUrl.href`だけをimportします。どちらもesbuildのwarning位置、正規化したsource contract、出現回数に加えて、build済みloader module全体を空白正規化したSHA-256がreview済み境界と一致しなければなりません。このmodule全体のdigestは昇格観測を許可するための検証にだけ使い、すでにbindされているHost bytesとは別にPromotion Subject manifestへ重複追加しません。materialize処理、entry選択、callsiteからのprovenance、target式の変更、loadの削除・複製、追加の非literal dynamic import、または他のHost moduleへの非literal dynamic loading追加はfail closedで拒否します。解析できない`require()`は引き続きすべてのHost moduleで禁止します。

bootstrap readinessとexecution probeはStage 0のproject builderを実際に使うため、`project/project.js`も製品identityの外には置きません。build済みcheckoutからNode寄りのpackage conditionとentry field選択で実際のruntime input graphを解決し、Compiler pipelineが実行する具体的なinstalled package bytesまで推移的にhashします。packageの`sideEffects` annotationだけを理由にbare runtime importをclosureから落としません。未解決の非Node external、解析できないdynamic `import()`や`require()`、require closureを明示的にmodel化していないCommonJS input、path escape、symlink traversal、不正なinputはfail closedで拒否します。これによりparserやsource-map実装など実行に必要なdependencyをbindしつつ、無関係なpackage、documentation、promotion-history tooling、lockfile全体まで製品identityへ取り込むことはありません。

現在のCompilerはHost境界moduleからLegacy adapterをstatic importしているため、保守的なPromotion SubjectではLegacy adapterを固定Host集合の一部としてbindします。そのためLegacy adapterのbytesが変わればSelf-host観測のSubjectもresetされ得ますが、promotion identityを狭くするためだけにCompilerの実行構造を変更することは避けます。製品境界を狭める必要がある場合は、Promotion toolingとは独立したCompiler architecture上の必要性を別途証明する必要があります。

bootstrap正規化policyは別名の実装closureとして扱い、相対importを推移的に追跡します。解析できないdynamic `import()`や`require()`のtargetは未追跡runtime dependencyとして扱わず、fail closedで拒否します。必須ファイルの欠落、symlink、不正なbuild済みJavaScript、closure外へ逃げる相対import、不正なrelease証拠、Seed／Stage 3 identityの不一致もfail closedで拒否します。

## 証拠の生成

fixed Seed、baseline clean bootstrap、perturbed clean bootstrapは別々のjobで実行します。baselineとperturbedは、execution commit、Seed、Stage 1／2／3、lockfile、Stage 3 candidateのidentityが完全に一致しなければcross-runner reproducibilityを成功にしません。

最終観測には、現在の`required-selfhost` policyが要求するevidence IDをすべて保持します。quality laneでは少なくとも次を明示的に記録します。

- bootstrap smokeとdifferential smoke
- Viruneのformat／type check
- repository unit test
- binding corpus
- managed Chromium／Firefox／WebKitによるbrowser integration
- full conformanceとProject Compiler differential
- 保存済みfuzz regressionと、固定seedによるSelf-host semantic differential fuzz

performance証拠は、expected divergenceのないproject corpus全体についてLegacyとSelf-host Project Compilerを比較し、Self-host Gate Dの数値比率を適用します。ただし現在のedited rebuild測定はproxyであり、incremental cache性能を証明しません。Gate Dは実際のincremental build比較を要求するため、このproxyから`performance-smoke`または`performance-budget`をpassにはしません。比較可能なincremental evidenceが得られるまではcanonical observationを`product-failed`とし、観測toolingの都合でCompilerを変更したりGate Dを弱めたりしません。

各evidence recordには、実行command、必要な環境変数、stdout／stderr等のSHA-256をcanonicalな形で保存します。最終assemblerはtop-levelのstatusを信用せず、release-core／cross-runnerのself-hash、Promotion Subjectの再正規化、quality evidenceのself-hash、performance corpusとGate D claim、現在policyのrequired evidence集合、performance比率を再検証します。artifactを書き出す直前には、canonical observationを現在のblocking promotion policyへもう一度replayし、安全下限も検証します。thresholdの弱体化や未対応のblocking policy fieldなど、現在policyが不正な場合はcanonical observationを生成せずfail closedで停止します。

## failureの扱い

原因を製品に帰属できるquality failureやperformance budget failureは、`outcome: product-failed`の観測として残せます。このとき、実際に確認していない未説明差分を捏造して加算しません。

managed browser testの非zero終了は、製品の挙動だけでなくbrowserやrunner環境の障害でも起こり得ます。そのためquality laneは、曖昧なexit codeだけから製品failureと推測しません。該当commandのnon-zero分類を`infrastructure-unknown`として証拠へ残し、canonicalな`product-failed` observationは生成しません。後続の履歴層では、結果として欠落または不正となったobservationをstreak-breaking gapとして扱います。製品に帰属できる証拠がないまま恒久失格にするより、unknownなgapとしてfail closedに扱います。

必須証拠の欠落、不正形式、stale commit、cross-runner不一致、不完全な証拠、信頼できない証拠ではcanonical observationを生成しません。履歴aggregation側では、安全と推測せず、artifact欠落または不正としてgapを記録します。

infrastructure failureやcancelled runを製品成功へ昇格させません。手動実行や信頼条件を満たさないsourceのartifactはnon-countingであり、正式な観測thresholdには寄与しません。

## Artifact contract

assemblyが成功した場合、workflowは次のcanonical observation artifactを1件だけuploadします。

```text
artifact: selfhost-promotion-observation-<run-id>-<run-attempt>
file:     observation.json
```

artifactはversion 2履歴のaggregationと監査のため30日保持します。観測は常に`productionEligible: false`です。このworkflowは昇格を承認せず、thresholdを変更せず、Production compilerを切り替えず、Required Shadowのexact-head検証を弱めず、Shadow History version 1も廃止しません。
