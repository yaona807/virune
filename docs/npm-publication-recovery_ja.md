# npm publication recovery

[English](npm-publication-recovery.md) | [日本語](npm-publication-recovery_ja.md)

このpolicyは、将来のreview済み変更でnpm publicationが有効化された後にだけ適用します。現在のrepositoryをpublication-readyにはしません。

すべてのrecovery判断は、planned package集合全体について **public npm Registryをfreshに観測**するところから開始します。cache済み、partial、malformed、unavailable、contradictory、その他unknownな観測結果からwriteを許可してはいけません。通常のpublication gateもreadyである必要があり、writeは`PUBLICATION-MANIFEST.json`で固定したexact reviewed release identityだけを使用します。

観測したpackage versionを`exact`と扱えるのは、immutableなidentity evidenceがすべて一致した場合だけです。package nameはpublication manifestのRegistry name、package versionはpublication manifestのversionと一致する必要があります。Registryの`dist.integrity`でdownloadしたtarballを検証し、**downloadしたtarballのSHA-256**はreview済みcandidateのSHA-256と一致させます。provenanceで結び付いた **source repository・source commit・provenance workflow** もreview済み／承認済みrelease identityと一致させます。identity evidenceが欠落または検証不能ならexact matchではなく、recovery writeを許可しません。canonical dist-tagはmutableなRegistry stateとして別に検証し、package-version identityへ混ぜません。

## Package-version recovery

一度publishされたnpm package versionは不可逆なidentityとして扱います。

| 観測状態 | 判断 |
|---|---|
| planned package versionが1つも存在しない | 通常のpublication gateを満たした場合のみ、dependency-safeな順序でreview済みcandidateをpublishする。 |
| **exact subset**だけが存在し、観測済みpackageがすべてreviewed identityと一致する | **未publishのreview済みcandidateだけ**を再開する。既存packageは書き直さない。 |
| planned versionがすべて存在し一致する | package-version writeを行わず、別のpublic Registry verification境界へ進む。 |
| bytes、version、provenance、repository/source identity、その他immutableなreviewed identityのいずれかが不一致 | **そのpackage versionの再利用を永久に禁止**する。新しいrelease versionが必要。 |
| unexpectedまたはcontradictoryなRegistry状態 | manual investigationまで停止する。 |
| unavailable、stale、partial、malformed、timeout、その他unknown | 再観測まで停止する。**unknown状態はwriteを一切許可しない**。 |

unpublish→republish、review後のrebuild、同一versionで異なるbytesをpublish、別source headからのpublishはrecoveryとして禁止します。

## Canonical dist-tagの適用

normal pathはnpm Trusted Publishing/OIDCを使います。npmは現在、Trusted Publishingで`npm publish`と`npm stage publish`を認証しますが、別の`npm dist-tag add/rm` commandはOIDC認証対象ではありません。そのためViruneは、別のtoken-authenticated tag-promotion phaseを作らず、review済みchannel tagを **`npm publish --tag`** で直接適用します。

stableは`latest`、承認済みprereleaseは`next`を使用し、nightlyはnpmへpublishしません。publicationは **dependency-safeな順序** で行い、**CLIを最後**にpublishします。packageのcanonical tagが見える時点で、そのpackageが必要とするexact Virune package dependencyはすべてRegistry上に存在していなければなりません。`virune` CLIは5つのplanned dependency packageがすべてexactになるまで進めません。

missing target versionをpublishする前に、現在のcanonical tag targetとreview済みtargetを **SemVer precedence** で比較します。normal pathでは **canonical tagを過去versionへ巻き戻さない** ことを必須とし、現在の`latest`または`next`がreview済みtargetと同一またはそれより新しいversionを指している場合、`npm publish --tag`より前に停止します。malformedなtargetや、観測したpackage version集合に存在しないtargetを指すtagもfail-closedで停止します。

retryで既存の`name@version`をskipできるのは、immutableなpackage identityが一致し、canonical tagもreview済みversionを指している場合だけです。canonical tagが不一致または外部でdriftしていてもimmutableなpackage-version identity自体が変わるわけではありませんが、normal publication pathは停止します。recoveryでは **別の`npm dist-tag` mutationを使わない** うえ、tag修復のための **traditional token fallback** も導入しません。この状態はTrusted Publishing境界を暗黙に弱めず、明示的な外部調査対象とします。

writeまたはskipがすべて終わった後、planned package集合全体をもう一度観測します。すべてのpackageが引き続きexactで、canonical tag stateもreview済みreleaseと一致していることを確認できるまでpublicationをconvergedとは扱いません。

## Completion

package versionがすべて収束しても、別途 **public Registry verification** が成功するまではrelease完了ではありません。このverificationは親npm publication planのblockerとして残し、Registry-installed consumer pathを実行します。
