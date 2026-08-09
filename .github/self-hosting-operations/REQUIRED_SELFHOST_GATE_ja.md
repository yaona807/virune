# Required self-host gate

[English](REQUIRED_SELFHOST_GATE.md) | [日本語](REQUIRED_SELFHOST_GATE_ja.md)

Viruneは現在、正本の`required-selfhost`昇格段階に対する **Required Shadow候補**を検証しています。安定したcheck名は`Required self-host gate`ですが、このcheckが成功してもblockingなrequired-selfhost段階へ自動昇格せず、production compiler defaultも変更しません。生成summaryは常に`productionEligible: false`かつ`promotionEligible: false`です。

正本は`.github/self-hosting/promotion-policy-v1.json`です。`required-selfhost`段階への昇格には、最低 **14回連続成功・14日間の観測・手動承認**が必要です。自動昇格は禁止されています。後続の`required-compiler`段階は別に維持するため、一般的な`packages/compiler/src/**`変更はself-host固有パスに触れない限り、まだRequired Shadow対象にはしません。

workflow自体は`main`向けの全Pull Requestで実行し、check名が常に存在するようにします。`scripts/classify-ci-changes.mjs`はRequired Shadow専用の`selfhost_required_gate_required`判定を出力します。無関係な変更では高コストなbootstrap proofを実行せず、明示的な`omitted` summaryを生成して成功します。空または不正な判定はfail-safeです。

Stage 3のself-host影響変更では、Pull Requestのexact headについて次をすべて要求します。

1. `run-selfhost-release-gate.mjs`で、固定Seed検証、Stage 1 → Stage 2 transition記録、Stage 2 == Stage 3の厳密固定点、dependency-offline clean bootstrap、Legacy rollback、step間generation bindingが成功すること。
2. 独立runner上でperturbed environment profileのclean bootstrapをもう1回実行すること。
3. `compare-selfhost-clean-bootstrap-evidence.mjs`で、baseline/perturbed間のrepository commit、lockfile、Seed、Stage 1/2/3、candidate artifact digestが一致すること。
4. `run-selfhost-required-gate.mjs`でrelease-coreとcross-runner evidenceを同一compiler generationかつPull Requestのexact commitへ束縛し、観測履歴と手動承認が未充足であることを明示すること。

正本promotion policyでは、`fixed-seed-verification`、`stage1-stage2-transition`、`stage2-stage3-fixed-point`、`environment-perturbation`、`independent-runner-reproducibility`、`cross-evidence-generation-binding`、`exact-head-evidence-binding`、`legacy-rollback`などを現行evidenceとして要求します。旧来のStage 1 == Stage 2 equalityモデルは拒否します。

Nightly acceptanceを完了扱いにする前に、Nightly固定点evidenceの実artifactを別途確認する必要があります。既存self-host Nightly laneはnon-blockingなので、genericなNightly workflow成功だけでは不十分です。同様に、1件のPull Requestでこの候補checkが成功しただけでrepository-required statusへ設定してはいけません。14回・14日・手動承認は独立した昇格条件として残ります。

上流evidence jobが失敗した場合、summary jobは古いproofや別commitへフォールバックせずfail-closed結果を記録します。workflowへのpath filter追加や、CI成功だけをstage昇格として扱う迂回は禁止します。
