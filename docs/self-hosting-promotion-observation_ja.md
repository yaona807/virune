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
- version付きで明示したSelf-host Hostの実行・選択境界ファイル集合
- build済みRuntime artifactとRuntime ABI
- build済みStandard Library artifact

Host componentは、実行・選択境界として明示した固定ファイル集合だけをhashします。Legacy Compiler本体、differential test用adapter、昇格履歴tool、documentation、governance metadataを再帰的に取り込みません。そのため、Self-host製品が変わっていないのにLegacyや文書だけの変更で観測期間がリセットされることはありません。一方、明示されたHost境界が変われば製品identityも変わります。

bootstrap正規化policyは性質が異なり、実装closureそのものが意味を持つため、相対importを推移的に追跡します。必須ファイルの欠落、symlink、不正なbuild済みJavaScript、closure外へ逃げる相対import、不正なrelease証拠、Seed／Stage 3 identityの不一致はfail closedで拒否します。

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

performance証拠は固定project corpusでLegacyとSelf-host Project Compilerを比較し、Self-host Gate Dの比率を適用します。edited rebuildはproxyであり、incremental cacheを検証したとは扱いません。

各evidence recordには、実行command、必要な環境変数、stdout／stderr等のSHA-256をcanonicalな形で保存します。最終assemblerはtop-levelのstatusを信用せず、release-core／cross-runnerのself-hash、Promotion Subjectの再正規化、quality evidenceのself-hash、現在policyのrequired evidence集合、performance比率を再検証します。

## failureの扱い

原因を製品に帰属できるquality failureやperformance budget failureは、`outcome: product-failed`の観測として残せます。このとき、実際に確認していない未説明差分を捏造して加算しません。

必須証拠の欠落、不正形式、stale commit、cross-runner不一致、不完全な証拠、信頼できない証拠ではcanonical observationを生成しません。履歴aggregation側では、安全と推測せず、artifact欠落または不正としてgapを記録します。

infrastructure failureやcancelled runを製品成功へ昇格させません。手動実行や信頼条件を満たさないsourceのartifactはnon-countingであり、正式な観測thresholdには寄与しません。

## Artifact contract

assemblyが成功した場合、workflowは次のcanonical observation artifactを1件だけuploadします。

```text
artifact: selfhost-promotion-observation-<run-id>-<run-attempt>
file:     observation.json
```

artifactはversion 2履歴のaggregationと監査のため30日保持します。観測は常に`productionEligible: false`です。このworkflowは昇格を承認せず、thresholdを変更せず、Production compilerを切り替えず、Required Shadowのexact-head検証を弱めず、Shadow History version 1も廃止しません。
