# セルフホスト昇格エビデンス評価

[English](self-hosting-promotion-evidence.md) | [日本語](self-hosting-promotion-evidence_ja.md)

昇格エビデンス評価器は、リポジトリに保存されたセルフホスト昇格policyを、1つの厳密なcompiler candidateへ適用します。純粋なTypeScript Host componentであり、決定論的な判定recordを返すだけです。workflow、branch protection、compiler default、release channel、repository状態は変更しません。

## 入力

評価器は、data-onlyな次の3入力を受け取ります。

1. versioned promotion policy
2. 要求するpromotion stage ID
3. candidateに結び付いたevidence observation

Observationには次を含めます。

- 40文字または64文字のcandidate SHA
- 連続成功run数と観測日数
- 未説明differential数
- manual approval、rollback evidence、stable release cycleの値
- ID、passed／failed status、candidate SHA、source、完了timestampを持つevidence item

すべてのevidence itemは同一candidate SHAに結び付けます。別commitのevidenceはstaleであり、再利用できません。

## Fail Closed判定

次のいずれかがあれば昇格をblockedにします。

- policy、stage、requirement、observation、evidence dataの破損
- 不明または重複したstage ID
- 重複したevidence ID
- 必須evidenceの欠損
- failed evidence（選択stageで必須ではない追加evidenceも含む）
- 別candidate SHAに結び付いたevidence
- 連続成功run数または観測日数の不足
- policy上限を超える未説明differential
- 必須manual approvalまたはrollback evidenceの欠損
- stable release cycleの不足

理由は決定論的な評価順で返します。必須evidenceはpolicy記載順、thresholdは固定順で評価します。

## Decision値

結果は次のいずれかです。

- `blocked`: Fail Closed理由が1件以上ある
- `manual`: evidenceは適格だが、policyまたはstageが人間による昇格を要求する
- `automatic`: evidenceが適格で、global policyとstageの両方が自動昇格を許可する

現在のpolicyは`automaticPromotionAllowed: false`であるため、適格なcandidateでも`manual`を返します。評価器自身はmanual actionを実行しません。

## Candidateとthresholdの出力

結果には次を含めます。

- 小文字へ正規化したcandidate SHA
- eligibilityとdecision
- missing、failed、stale evidence ID
- 成功run数と観測日数の実績値／必要値
- 未説明differentialの実績値／上限値
- stable release cycleの実績値／必要値
- code、path、messageを持つ構造化reason

同一policy、stage、observation入力は常に同一結果を返します。

## 対象外

このcomponentは次を行いません。

- `.github/self-hosting/promotion-policy-v1.json`の変更
- nightly、required、production workflowの有効化
- GitHubなど外部systemからのevidence収集
- approve、merge、release、compiler実装切替
- grammar、Compiler API、Runtime ABI、Interop ABI、公開標準ライブラリの変更

Evidenceの収集、保存、signature／attestation検証、昇格実行は別のHost責務です。それぞれ独立したreview済み変更を必要とします。
