# Virune Project Governance

English: [GOVERNANCE.md](GOVERNANCE.md)

## 現在のGovernance model

Viruneは現在、Project Maintainer 1名で運営されるpublic open-source projectです。現在のProject Maintainerは[`@yaona807`](https://github.com/yaona807)です。この文書は、**現在実際に存在するgovernance**を記述します。Steering committee、投票機関、foundation、追加Maintainer roleが存在することを暗黙に定めるものではありません。

現在のcode、public specification、repository-owned policy、Issue、Pull Request、review evidenceについてはpublic repositoryを正本とします。[CONTRIBUTING_ja.md](CONTRIBUTING_ja.md)をContributor workflowの正本、[SECURITY_ja.md](SECURITY_ja.md)をsecurity reporting policyの正本とします。

Private note、automation coordination、Maintainerだけが利用する作業状態は、該当する要件がrepositoryまたはpublicに参照可能なcanonical project artifactへ反映されない限り、external contributorへの義務やmerge eligibilityを新たに発生させません。

## Maintainerの責務と権限

現在のProject Maintainerは次を担当します。

- IssueとPull Requestのtriage
- Public roadmapとwork-item boundaryの維持
- 変更のreviewとmerge
- Repository settingsとrequired validationの維持
- Releaseとdistributionの判断
- Security policyに基づくsecurity responseの調整
- [Code of Conduct](CODE_OF_CONDUCT_ja.md)に基づくProject管理下community spaceのmoderation
- Public project policyと実際のProject運用の整合維持

Maintainerの権限は、Viruneで文書化されたcorrectness、safety、compatibility、determinism、reproducibility、review、release boundaryを迂回する権限ではありません。Maintainerが変更を望んでいるという理由だけで、unknownまたは未解決の状態をsafeまたはcompleteとして扱ってはいけません。

## Decisionの分類

### 通常のimplementation decision

通常のbug fix、feature、test、refactor、documentation、CI改善は[CONTRIBUTING_ja.md](CONTRIBUTING_ja.md)に従います。適切なIssueを使用し、Pull Requestを1 logical changeに限定し、behaviorをvalidateし、adversarial reviewを実行し、merge前にcurrent exact headのformal CI evidenceを確認します。

### Public contractの変更

Language Specification、Compiler API、Runtime ABI、Interop ABI、public standard library、外部が利用するmachine-readable output、compatibility promise、その他のreview済みpublic contractへ影響する変更には、影響するboundaryとmigration/compatibility impactを明記したIssueまたはproposalが必要です。

その変更をimplementation convenience、Self-hosting convenience、またはCIを通すことだけで正当化してはいけません。Merge前に、該当するtestとpublic documentation、compatibility/safety analysis、actionable finding 0件までのadversarial review、current exact headのformal CI、final exact-head reviewが必要です。

### Security decision

公開することでriskが増える間、security-sensitiveな調査をprivateに扱うことがあります。Process、supported-version boundary、remediation requirement、最終的なpublic disclosure recordは[SECURITY_ja.md](SECURITY_ja.md)に従います。Confidentialに扱うことを理由に、required security/release/regression validationを暗黙に弱めてはいけません。

### Release decision

Releaseは、repositoryで適用されるrelease、security、compatibility、reproducibility gateを満たした後に行う明示的なMaintainer decisionです。Release固有のpolicyやobservation requirementが未解決である場合、CI successだけをpublishの根拠にはできません。

### Governance decision

Contributor obligation、Maintainer authority、moderation authority、merge policy、release authority、またはこのgovernance modelを変更する場合、明示的なgovernance Issueとreview可能なrepository changeが必要です。Public Markdownのgovernance documentは英語と日本語を同一変更で維持します。

## Decisionの決め方

Viruneは現在、majority votingやformal consensus committeeを使用していません。Contributorには、関連IssueまたはPull Requestでevidence、alternative、compatibility impact、具体的なobjectionを提示することを推奨します。Maintainerは、文書化されたProject原則とreview済みevidenceに基づいて最終的なProject decisionを行い、安全に公開できる重要なrationaleはpublic work itemへ残します。

意見の相違を、後からAcceptance Criteriaを狭める、gateを弱める、unknown stateをsuccessとして扱うことで解消してはいけません。Evidenceが不足している場合、そのdecisionはunresolvedのままとするか、変更をunmergedのまま維持します。

## Maintainerの追加・変更

Contribution数、勤務先、sponsorship、Project参加期間による自動的なMaintainer昇格はありません。Viruneには現在、権限を委譲できる追加Maintainer teamは存在しません。

将来Maintainerを追加する場合、まず実際に付与するauthorityを文書化します。必要に応じてreview/merge scope、release authority、security access、moderation responsibility、repository administrationを明示し、permissionはroleに必要な範囲を超えないようにします。

またViruneは現在、sole maintainer自身に関するreportについて独立したmoderation bodyが存在するとは表明していません。この制約は[CODE_OF_CONDUCT_ja.md](CODE_OF_CONDUCT_ja.md)に記載します。将来独立したmoderation processを設ける場合、Projectがその仕組みの存在を表明する前に、実際のresponsible partyとauthorityを明示する必要があります。

## Emergencyとcontinuity boundary

Security incident、credential compromise、infrastructure failure、Maintainer不在などでは、merge、publication、release activityを停止することがあります。ただしrequired safety/provenance checkを迂回する理由にはなりません。

Official Virune project identityやadministrative assetの自動的な移管手順は現在定義されていません。より広いcontinuity workは[Issue #248](https://github.com/yaona807/virune/issues/248)でtrackingしています。Apache-2.0はLicenseに従ったforkを認めますが、developmentを継続したという理由だけでforkがofficial Virune releaseになるわけではありません。

## この文書の変更

Governance変更では、解決するproblem、変更されるauthorityまたはobligation、compatibility/safety implication、既存workに対するtransitionを記述してください。[GOVERNANCE.md](GOVERNANCE.md)と[GOVERNANCE_ja.md](GOVERNANCE_ja.md)は同一Pull Requestで更新します。
