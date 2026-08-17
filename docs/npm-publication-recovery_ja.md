# npm publication recovery

[English](npm-publication-recovery.md) | [日本語](npm-publication-recovery_ja.md)

このpolicyは、将来のreview済み変更でnpm publicationが有効化された後にだけ適用します。現在のrepositoryをpublication-readyにはしません。

すべてのrecovery判断は、planned package集合全体について **public npm Registryをfreshに観測**するところから開始します。cache済み、partial、malformed、unavailable、contradictory、その他unknownな観測結果からwriteを許可してはいけません。通常のpublication gateもreadyである必要があり、writeは`PUBLICATION-MANIFEST.json`で固定したexact reviewed release identityだけを使用します。

観測したpackageを`exact`と扱えるのは、必要なidentity evidenceがすべて一致した場合だけです。package name、package version、Registryの`dist.integrity`、review済みcandidateと比較した **downloadしたtarballのSHA-256**、provenanceで結び付いた **source repository・source commit・provenance workflow** を確認します。identity evidenceが欠落または検証不能ならexact matchではなく、recovery writeを許可しません。将来のpublication/verification実装はこれらの観測値をreviewed release identityへ結び付ける必要があり、証拠が取得できない場合にこのpolicyが代替値を推測することはありません。

## Package-version phase

一度publishされたnpm package versionは不可逆なidentityとして扱います。

| 観測状態 | 判断 |
|---|---|
| planned package versionが1つも存在しない | 通常のpublication gateを満たした場合のみ、全review済みcandidateをpublishする。 |
| **exact subset**だけが存在し、観測済みpackageがすべてreviewed identityと一致する | **未publishのreview済みcandidateだけ**を再開する。既存packageは書き直さない。 |
| planned versionがすべて存在し一致する | package-version writeを停止し、dist-tag phaseへ進む。 |
| bytes、version、provenance、repository/source identity、その他reviewed identityのいずれかが不一致 | **そのpackage versionの再利用を永久に禁止**する。新しいrelease versionが必要。 |
| unexpectedまたはcontradictoryなRegistry状態 | manual investigationまで停止する。 |
| unavailable、stale、partial、malformed、timeout、その他unknown | 再観測まで停止する。**unknown状態はwriteを一切許可しない**。 |

unpublish→republish、review後のrebuild、同一versionで異なるbytesをpublish、別source headからのpublishはrecoveryとして禁止します。

## Dist-tag phase

package-version publicationと **dist-tag promotion** は別phaseです。planned package versionがすべてfreshに観測され、exact reviewed identityと一致した後にだけcanonical tagをpromotionできます。

stableは`latest`、承認済みprereleaseは`next`へ収束し、nightlyはnpmへpublishしません。recoveryでは現在のcanonical tag targetと対象releaseを **SemVer precedence** で比較し、**canonical tagを過去versionへ巻き戻さない**ことを保証します。`latest`または`next`が対象より**より新しいversionを指している場合、recoveryはstaleとして停止**し、tagをdowngradeしてはいけません。unexpectedまたはnon-canonicalなtargetもmanual investigationまで停止します。missing、より古いversion、対象version一致、またはpartial promotionの場合だけtag収束へ進めます。

canonical tagがpartialにpromotionされた場合、packageをrepublishしてはいけません。**tagだけを再観測して収束**させ、planned packageすべてを意図したcanonical tag targetへ一致させます。

## Completion

package versionとcanonical tagが収束しても、別途 **public Registry verification** が成功するまではrelease完了ではありません。このverificationは親npm publication planのblockerとして残します。
