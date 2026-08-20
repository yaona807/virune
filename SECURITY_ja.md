# セキュリティポリシー

English: [SECURITY.md](SECURITY.md)

## サポート対象のバージョン

最新の安定版リリース系列と`main`をサポート対象とします。過去のリリース系列は、重大な脆弱性に対する一時的なバックポート期間をメンテナーが明示的に告知した場合を除き、サポート対象外です。

| Version | Supported |
|---|---|
| `main` | Yes |
| Latest stable release | Yes |
| Older releases | 明示的な告知がある場合を除きNo |

## 脆弱性の報告

セキュリティ脆弱性の疑いをpublic Issue、Discussion、Pull Request、social channelへ公開しないでください。

[GitHub private vulnerability reporting](https://github.com/yaona807/virune/security/advisories/new)を使用して報告してください。可能な場合、次を含めてください。

- 影響を受けるversion、release asset、またはcommit
- compiler、runtime、CLI、VS Code extension、language server、JavaScript interoperability layerなどの影響を受けるcomponent
- 最小のreproductionまたはproof of concept
- 想定されるimpactと攻撃に必要なcapability
- 判明しているworkaroundまたはmitigation
- Disclosure deadlineが設定されているか

GitHub private vulnerability reportingを利用できない場合、publicな **Security contact request** Issue Formは、あなたのGitHub profileにprivate communicationへ利用できるcontact methodが既に公開されており、Virune Maintainerがその方法を使用することに同意できる場合だけ利用してください。Request Issue、そのauthor、title、bodyはpublicかつeditableです。Titleとbodyの両方へvulnerability details、affected version、reproduction/exploit step、secret、contact address、その他のsensitive informationを記載しないでください。Security contactを求めている事実自体をconfidentialにする必要がある場合、public formを使用しないでください。Maintainerはprofile上ですでに公開されているprivate-capable contact routeを利用してprivateな連絡へ移行できます。

Profileに利用可能なprivate-capable contact routeがない場合、Viruneは現時点でconfidentialなProject-level fallback intake pathを保証できません。Responseを得るためにvulnerability detailsをpublicへ開示しないでください。Unknownなprivate-delivery capabilityを利用可能として扱ってはいけません。

Viruneがprivate channelを通じて実際に受領し、triage開始に十分な情報があるreportについて、Maintainerは3 business days以内のacknowledgement、7 business days以内のinitial severity/remediation assessmentを目標とします。Complexなreportでは追加調査が必要になる場合があります。

## Scopeとsecurity model

Viruneはsecurity sandboxではありません。Generated JavaScriptはhost environmentのpermissionで実行されます。JavaScript execution、`unsafe` interoperability、third-party package、generated project dependency、host APIはViruneのstatic safety guaranteeの対象外です。

一方、例えば次の内容はreport対象になり得ます。

- untrusted source inputによって発生するcompiler、formatter、parser、language-server crash
- CLIまたはextensionにおけるarbitrary code executionや意図しないfilesystem/process access
- JavaScriptまたはTypeScript boundaryでのunsafe validation
- malicious release asset、dependency confusion、compromised build provenance
- secretを露出するsource-map、diagnostic、generated-code behavior
- toolingまたはserviceに対して現実的なattack pathを持つdenial of service

## Private remediation workflow

1. Private advisory workspaceでreportをreproduceしtriageします。
2. 影響を受けるversion、severity、exploit prerequisite、disclosure planを記録します。
3. Release前のdisclosureでriskが増える場合は、advisoryのprivate forkでfixを開発します。
4. 可能な限り、fix前にfailしfix後にpassするregression testを追加します。
5. Metadata validation、type checking、unit/integration test、VS Code/language-server test、release artifact verification、CodeQL、dependency reviewなど、関連するrepository gateを実行します。
6. Transitive dependency change、generated file、release metadata、workflow permissionをreviewします。
7. Release note、upgrade instruction、mitigation、希望がある場合のreporter creditを準備します。
8. Fixed releaseとGitHub Security Advisoryを同時にpublishするか、合意したdisclosure timeに合わせます。
9. Published assetとchecksumをverifyし、exposed credentialがあればrotateまたはrevokeします。
10. Supported versionとpublic documentationがfixed versionを特定できる状態になってからadvisoryをcloseします。

Security fixでも通常のrelease workflowを使用します。Stable release assetはimmutableとして扱い、既存stable assetを置換せずcorrected versionをpublishします。

## Required repository security settings

Maintainerはstable release前、および少なくともquarterlyに次のsettingを確認する必要があります。

- private vulnerability reportingがenabled
- dependency graph、Dependabot alerts、security updates、version updatesがenabled
- secret scanningがenabled
- 対応するsecretに対するpush protectionがenabled
- `.github/workflows/codeql.yml`によるCodeQL advanced setupがactive
- dependency-changing Pull Requestでdependency reviewがrequired
- branch protectionまたはrulesetが適用されるCI/security checkをrequiredにしている
- GitHub Actions permissionのdefaultがread-onlyであり、write scopeは必要とするworkflowだけへ付与されている

Repository settingsはGitだけでは完全に表現されないため、このchecklistは **Settings → Security and analysis**、**Settings → Actions**、branch ruleset configurationで確認する必要があります。

## Automated repository controls

次のcontrolはrepositoryからenforceされ、弱められた場合はpull-request metadata validationをfailさせます。

- `.github/dependabot.yml`がnpmとGitHub Actions dependencyをmonitorする
- `.github/workflows/codeql.yml`がPull Request、push、weekly schedule、manual runでJavaScript/TypeScriptをanalyzeする
- `.github/workflows/dependency-review.yml`がGitHub Dependency Reviewでchange-levelのmoderate以上のfindingを要求し、さらに`npm audit`でlockされたruntime/development dependency全体のmoderate以上のfindingを常にblockする
- `.github/actions-policy.json`がexternal Action identity/revisionをallowlistする
- `scripts/verify-workflows.mjs`がすべてのworkflowへexact top-level permission declarationを要求し、defaultを`contents: read`とし、review済みper-file exceptionでのみwrite scopeを許可する
- job-level permission overrideを禁止し、review済みworkflow grantをjobが暗黙に超えられないようにする

Git-managed validationだけでは、private vulnerability reporting、secret scanning、push protection、repository-wide Actions default、branch rulesetのcurrent stateを証明できません。Administratorはquarterly reviewでこれらのcontrolをGitHub settings上で確認する必要があります。GitHub change-level reviewが利用できない場合、workflowはその制約を明示的にreportし、complete locked-dependency auditをblocking fallbackとして維持します。GitHub review result自体をrequired gateにできるようにするには、Dependency Graphのenableが引き続き必要です。

## Public security discussion

Coordinated disclosure後は、GitHub Security Advisoryとrelease noteをcanonical public recordとして使用します。Public Issueでfollow-up hardening workをtrackingするのは、exploit-sensitive detailsを安全に公開できるようになってからにしてください。
