# 昇格policy replay version 2

[English](self-hosting-promotion-policy-replay-v2.md)

Promotion policy replayは、canonicalなShadow History version 2の証拠を**現在**のchecked-in昇格条件で再評価します。製品identityは変更せず、過去に「count対象だった」という判断もそのまま信用しません。

過去の成功runが現在policyでも有効になるのは、もともとtrusted/counting observationであり、かつ現在stageが要求する全evidence IDを`passed`状態で保持している場合だけです。後からpolicyへevidence Dが追加された場合、Dを記録していなかった古いrunはnon-qualifyingになりますが、製品failureへ遡及変更はしません。ただし正式なnon-qualifying observationは現在policy上の連続成功をそこで切ります。もともとDを記録していたrunは引き続き有効になれます。

一方、記録済みのcounting failureはfailureのままです。特にproduct failureは同じpromotion subjectを失格にし続け、infrastructure failureやcancelledはstreak breakとして残ります。policy強化によってfailure証拠を消すことは禁止します。

## Trusted observation source

別のpure source classifierが、run sourceをcallerから渡されたcanonical repository、workflow、refと比較します。正式countにはすべての一致、`eventName === schedule`、かつforkではないことを要求します。Manual dispatch、push、pull request、fork、またはsource不一致runはdiagnostic専用です。

このclassifierはViruneのrepository pathを製品identityへ埋め込みません。GitHub Actionsからtrusted source contractを渡す配線は次のsliceで行います。

## 出力

Replayは、現在のpromotion subject、required evidence set、連続成功回数、異なるUTC観測日数、恒久product-invalidated状態、未説明differential、policy threshold、qualifying run ID、除外runと理由、およびhistory部分のthreshold充足状態を返します。

Manual approval、rollback evidence、stable release cycleは別条件のままです。History thresholdが通っても昇格操作は行いません。
