# Viruneへのコントリビューション

English: [CONTRIBUTING.md](CONTRIBUTING.md)

Viruneへのコントリビューションありがとうございます。この文書では、Issue、branch、Pull Request、validation、review、Contributorの権利に関するrepository-levelの運用を定義します。

## 原則

優先順位は、correctness、safety、compatibility、determinism、reproducibility、maintainability、performance、implementation speedの順です。

実装やCIを容易にすることだけを理由に、言語semantics、安全境界、test、quality/security/compatibility/reproducibility gate、public API/ABI contractを弱めないでください。unknownまたは未解決の状態は保守的に扱い、根拠なしにsafeまたは成功へ昇格させないでください。

formattingとvalidationについては、repository-ownedの設定、script、CIを正本とします。新しいvalidation pathを追加する前に、既存commandを確認してください。

## Project policy

Contributorは、repositoryで公開されている次のProject policyにも従ってください。

- Communityでの行動と現在のmoderation boundaryは[Code of Conduct](CODE_OF_CONDUCT_ja.md)
- Maintainer authorityとProject decision-makingは[Project Governance](GOVERNANCE_ja.md)
- Vulnerability reportingとsecurity responseは[Security Policy](SECURITY_ja.md)

これらの文書はそれぞれ異なる責務を持ちます。該当する要件がpublicなcanonical project artifactへ反映されていない限り、privateなMaintainer noteやautomation専用の作業状態をContributorへの要件として扱わないでください。

## Security report

Security vulnerabilityの疑いを、public Issue、Discussion、Pull Request、その他のpublic channelへ公開しないでください。Private vulnerability reportingと、GitHub private vulnerability reportingを利用できない場合のfail-closedなfallback手順は[`SECURITY_ja.md`](SECURITY_ja.md)に従ってください。

## Contributorの権利とライセンス

Viruneの現在のproject-owned repository snapshotは[Apache License 2.0](LICENSE)で配布されています。明示的に別の条件を示さない限り、Viruneへ取り込む目的で意図して提出したContributionは、Apache License 2.0のSection 5に沿って、追加の条件を付けずに同Licenseのterms and conditionsの下で提出されるものとします。このguideとLicense本文が矛盾する場合は、License本文を優先します。

Contributionを提出する人は、そのContributionを提出するために必要な権利と権限を有していることについて責任を負います。勤務先、他project、private source、その他の第三者から取得したcodeやcontentなど、適用される条件上提出が認められていないmaterialを提出しないでください。

Contributionに第三者のcode、data、documentation、生成material、その他のcontentが含まれる、またはそれらから派生している場合、review上重要となるsourceと適用Licenseまたはpermissionを明示してください。必要なcopyright、attribution、license、notice情報を削除しないでください。provenanceまたはlicenseがunknown・未解決のmaterialをproject-ownedのApache-2.0 materialとして扱ってはいけません。merge前に解決できるようIssueまたはPull Requestで明示してください。

Code generationやAI-assisted developmentを利用したこと自体を理由に、特別な申告を必須とはしません。Contributionを提出する人は、使用したtoolにかかわらず、そのcorrectness、safety、provenance、licensing、およびこのrepositoryのreview・validation要件への適合について責任を負います。Toolの出力だけを、そのmaterialが安全に提出できることやProjectのLicenseと互換であることの根拠にしないでください。

Viruneのproject attributionは[`NOTICE`](NOTICE)に記録します。Contributorは、自身のoriginal contributionについて保有するcopyrightを引き続き保持します。上記条件でContributionを提出しても、copyright ownershipがProjectへ移転するものではありません。別途reviewされたgovernance上の理由なしに、project-wideのcopyrightまたはattribution noticeを追加・書き換えないでください。

Viruneでは現在、Contributor License Agreement（CLA）、Developer Certificate of Origin（DCO）、`Signed-off-by` lineを必須としていません。これらは、将来の具体的要件によって独立に必要性が正当化された場合のみ再検討します。通常のContributionが受理されたことによって、現在これらが要求されているとみなされることはありません。

Contributionの受理は、Projectが将来そのContributionを異なる条件でrelicenseできることを表明または保証するものではありません。

## Issue

Implementation変更は原則としてIssueへ紐付けてください。Tracking IssueとImplementation Issueを明示的に区別します。

### Work item role

Development work itemとして扱うすべてのIssueには、`Work item role`という名前のMarkdown headingと、その直後に次のどちらか1つのrole valueを明示します。

- `Implementation` — そのwork item自身の明示的かつobservableなcompletion criteriaによって完了を判定できる、1つの具体的なwork item。Change proposalでは通常Acceptance Criteriaを使い、Bug reportではrequiredなExpected behaviorをbaseline criterionとして必要に応じて追加のacceptance criteriaを指定します。
- `Tracking` — 独立したimplementation workをまとめる、または順序付けるためのparent/coordination item。通常のimplementation PRにおける唯一の実装根拠としては不十分です。

PublicなBug reportとChange proposalのIssue Formは、この2値をrequired selectionとして提供します。Project側で手動作成するIssueも同じheading/value contractを使用します。GitHub Issue Formsと手動作成IssueではMarkdown heading levelが異なる場合がありますが、heading名と単一のrole valueをsemantic contractとします。

Work item roleが欠落またはmalformedである場合、Issue title、label、author、path、branch名、recency、周辺のproseからroleを推測してはいけません。Triageで明示的に解決してください。

必要に応じて次を含めます。

- Background / Problem
- Goal
- Scope
- Acceptance Criteriaまたは同等の明示的かつobservableなcompletion criteria
- Non-goals
- Architecture / invariants
- Dependencies
- Compatibility / safety boundaries

PRがmergeされたことだけではIssue完了を意味しません。通常のimplementation workでは、`Closes`、`Fixes`、`Resolves`、GitHubのclosing relationshipではなくplainな`Refs #...`を使用します。Reviewed PRをmergeした後、current `main`上でIssueの明示的かつobservableなcompletion criteriaを確認し、必要に応じてcompletion evidenceを更新してからIssueを明示的にcloseします。Nightly、release、observation period、その他のpost-merge evidenceが必要な場合は、そのevidenceが揃うまでIssueをopenのまま維持してください。

通常のimplementation PRは`Implementation` Issueを参照する必要があります。必要に応じて1つ以上の`Tracking` parentも別に参照できますが、Tracking Issueはimplementation work itemの代わりにはなりません。

### Label taxonomy

Labelは整理用metadataにすぎません。safety、required CI、merge eligibilityの判断根拠にしてはいけません。

**Type** — 原則1つだけ:

`type:bug`, `type:feature`, `type:refactor`, `type:test`, `type:ci`, `type:docs`, `type:security`, `type:chore`

**Area** — 必要に応じて0個以上:

`area:compiler`, `area:selfhost`, `area:interop`, `area:runtime`, `area:stdlib`, `area:cli`, `area:dx`, `area:release`, `area:governance`

**Priority** — 任意、最大1つ:

`priority:p0`から`priority:p3`

**Workflow** — 例外状態だけ:

`workflow:validation-only`, `workflow:superseded`, `workflow:blocked`

Backlogまたは未着手のIssueはunassignedのままで構いません。Implementation workを実際に開始したら、その作業を継続して完了へ運ぶaccountableな人をassignしてください。Assigneeはownership metadataであり、concurrency lockでも、safetyやmerge eligibilityのevidenceでもありません。

## Branch

独立した作業はcurrent `main`から開始してください。

Branch名は目的と、可能ならIssueを識別できる名前を推奨します。例:

- `feat/326-interop-provider-facts`
- `fix/349-selfhost-propagation`
- `docs/269-contributor-workflow`

Stacked PRは例外です。stack depthは1を推奨し、2を超えないでください。

親PRがsquash mergeされた後、history修復が複雑になる場合は、childをcurrent `main`からcleanに再構築することを優先してください。ancestry repairだけのPRを通常運用として作らず、古いbranchやsuperseded branchを現在のものに見せるためだけにforce updateしないでください。

## Pull Request

各PRは1つのlogicalかつreview可能な変更に限定してください。Titleは`feat(interop): ...`、`fix(selfhost): ...`、`test(selfhost): ...`、`ci(selfhost): ...`、`docs(governance): ...`などのConventional Commit形式を推奨します。

必要に応じて次を記載してください。

- Summary / Scope
- plainな`Refs #...`によるImplementation Issue
- 必要な場合はTracking / parent Issueを別項目で記載
- Changed boundaries
- Non-goals / invariants
- Validation
- Compatibility / safety impact
- Stackまたはsuperseded relationship

Mutableなcurrent PR base/head identityについてはGitHubを正本とします。PR bodyへ手作業でコピーした`current base`や`current head` fieldをlive stateとして維持しないでください。Formal CI、artifact、その他のevidenceが1つのimmutable commitへ適用される場合は、そのevidenceとともにexact SHAを特定してください。PR headが変更された場合、以前のheadに対するevidenceはstaleであり、新しいheadのevidenceとして扱ってはいけません。

Safety-sensitiveな変更では、変更したものと意図的に変更していないものの両方を明示してください。

Implementation未完成、dependency待ち、formal validation未完了、validation-only、design review中の場合はDraft PRを使用してください。

Validation-only PRは明示的にその旨を示し、mergeしてはいけません。必要なevidenceを取得した後にcloseしてください。Superseded PRはreplacementを明示し、mergeしてはいけません。

原則としてsquash mergeを使用します。

## Testとvalidation

Behavior変更にはtestが必要です。Bug fixには可能な限りregression testを追加してください。

変更内容に応じて、positive/negative、malformed、stale、partial、unknown、boundary、cleanup/rollback、determinism、compatibilityなどのcaseを選択してください。

Test自体もreviewしてください。Assertionは誤ったimplementationを検出できる強さを持たせ、implementationと同じ誤解をtestへそのまま固定しないでください。

既存のrepository-owned commandを優先してください。General verificationや、focused Self-hosting inventory、differential、reconstruction、bootstrap、rollback checkを含む関連commandは`package.json`に定義されています。

## CI evidence

Formal CI evidenceはexact PR head SHAに紐付きます。Headが変更された後に、古いheadの成功を新しいheadのevidenceとして使わないでください。

Merge前に、必要に応じて次を確認します。

- current headのrequired formal checksが成功している
- required checkが意図せずmissingまたはskipされていない
- unresolved review threadが0
- PRにconflictがない
- Issue/PR固有gateを満たしている
- final adversarial reviewを通過している

CI failureは原因を分類してから対応します。

- **Repository / implementation failure:** 原因を修正し、新しいheadをvalidateします。同じheadをgreenになるまで盲目的にrerunしないでください。
- **Infrastructure failure:** repository変更が原因ではないとevidenceで確認できる場合に限り、同じheadをrerunできます。

繰り返し有用なdiagnosticは、temporary validation infrastructureへ依存せず、repository-owned commandまたはworkflowにしてください。

## 敵対的レビュー

Design、implementation、PR readiness、merge判断ではadversarial reviewが必要です。目的はimplementationを擁護することではなく、壊れる経路を見つけることです。

次のcycleを繰り返します。

1. Requirements、Acceptance Criteria、invariantsを再確認する。
2. Current implementation/diffを敵対的にreviewする。
3. Actionable findingを列挙する。
4. Findingが1件でもあれば修正する。
5. 必要なfocused validationを実行する。
6. 変更後の状態を最初から再reviewする。
7. 完全なreview passで新しいactionable findingが0件になるまで続ける。

Actionable findingとは、correctness、safety、specification compliance、compatibility、determinism、reproducibility、failure handling、security boundary、test validity、maintainability、scope integrity、documentation、recoveryを具体的に改善する問題です。

Actionable findingが0件になった後、styleだけのfindingを作り続けないでください。

最低限、次を疑ってください。

- Acceptance Criteriaを狭く解釈していないか
- happy pathだけで成立していないか
- malformed、stale、partial、duplicate、out-of-order inputで壊れないか
- unknownをsafeへ昇格していないか、fail-openになっていないか
- Language Specification、Compiler API、Runtime ABI、Interop ABI、target compatibilityを壊していないか
- locale、time、randomness、path、filesystem order、concurrency orderによるnondeterminismがないか
- testが弱すぎないか、implementationと同じ前提を共有していないか
- required checkやskip pathを弱めていないか
- stale CI/evidenceを利用していないか
- unrelated refactorやtemporary workaroundが混入していないか
- partial failure後のcleanup、rollback、retryが安全か

Source、test、configuration、workflow、artifact contract、relevant base、relevant specificationのいずれかが変わった場合、0件判定をresetし、最初からreviewしてください。

## Final exact-head review

Adversarial reviewでactionable findingが0件になった後、current exact headでrequired formal CIを実行します。その後、exact head identity、formal CI、final diff、unexpected files、review thread、Acceptance Criteria、evidence、残存TODO/temporary path、superseded relationshipを含むfinal adversarial reviewを実行してください。

Final reviewでactionable issueが1件でも見つかった場合はmergeしません。修正し、新しいheadについてrequired formal CIを再実行し、final reviewを繰り返してください。

Completionにはfinal exact headでactionable finding 0件が必要です。CI greenだけでは十分ではありません。

## Self-hosting guardrail

Self-hostingの都合でViruneのlanguage semanticsやsafety modelを変更してはいけません。現行のcanonical Self-hosting Issue/policyに従ってください。

Self-hostingを容易にすることだけを理由にgrammar/keywordを追加する、unsafe ruleを緩和する、compiler-only language featureを追加する、Self-host専用public stdlib APIを追加する、public API/ABI contractを壊す、quality/reproducibility gateを弱めることは禁止します。

原則として、次の順で解決してください。

1. 既存language featureを使った再設計
2. internal algorithmの改善
3. data-only contractの改善
4. Host側へ責務を残す
5. 一般利用でも独立して必要性が証明された場合のみ、別language proposalとして扱う
