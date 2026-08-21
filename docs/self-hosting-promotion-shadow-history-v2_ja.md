# 昇格Shadow履歴 version 2

[English](self-hosting-promotion-shadow-history-v2.md)

Shadow History version 2は、Git commitではなく**昇格対象の製品identity**ごとに長期観測を集約します。移行期間中は既存version 1 contractと並行運用します。

各entryには監査用として40文字のexact Git `executionCommit`を引き続き記録します。それとは別に、64文字の`promotionSubjectId`でstageごとの製品closureを識別します。そのため、実行commitが異なっても昇格対象の製品identityが同一なら同じ連続観測へ加算できます。

## Subject segment

履歴はcanonicalな完了時刻とrun IDで厳密に整列します。現在の正式なpromotion subjectは、最後の**counting** observationが選びます。そのsubjectが連続するcounting observationの末尾segmentだけを現在の正式履歴へ使います。Count対象のidentityがA → B → Aと戻っても、2回目のAは新しい正式segmentとして開始し、最初のAの観測は復活させません。

Non-counting診断は自身の`promotionSubjectId`を監査証拠として保持しますが、現在の正式subjectを動かさず、正式subject segmentを開始・リセットもしません。Count対象observationが履歴に1件もない場合だけ、最新diagnosticのsubjectを表示上のidentityとして使い、正式カウンターはすべて0のままにします。

## Outcomeとcountingの意味

各runはoutcomeと独立した`countsTowardPromotion`を持ちます。

- counting `passed`は末尾の連続成功を伸ばします。
- counting `infrastructure-failed`または`cancelled`はstreakをリセットしますが、製品subject自体は恒久失格にしません。
- counting `product-failed`はそのpromotion subjectを失格とし、別subjectを経由して同じidentityが再登場しても成功回数と観測日数を0のまま維持します。
- non-counting observationは監査証拠として保持しますが、正式streakを増やさず、リセットせず、正式promotion subjectも動かしません。

未説明differentialを0より大きくできるのは`product-failed`だけです。`infrastructure-failed`と`cancelled`は一時的なstreak breakと実行履歴を表すもので、製品の恒久的なdifferential証拠ではないため、未説明differentialは必ず0件にします。成功run数とは別にUTC日付の種類数を数えるため、同日に複数回実行しても観測日数は水増しされません。

どのtrusted workflow eventが`countsTowardPromotion=true`を設定できるかは、後続のobservation collection層で決定します。

## 境界

Version 2 historyは、trusted GitHub eventの選別、現在policyによる昇格評価、昇格承認、Production compiler切り替え、version 1履歴の廃止を行いません。また変更file pathから製品identityを推測しません。
