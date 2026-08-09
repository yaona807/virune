# Required self-host gate

[English](REQUIRED_SELFHOST_GATE.md) | [日本語](REQUIRED_SELFHOST_GATE_ja.md)

Self-hostingの昇格経路は現在 **Required Shadow** 段階です。安定したcheck名は`Required self-host gate`ですが、この段階ではproduction compiler defaultを変更せず、生成するsummaryは常に`productionEligible: false`のままです。

workflow自体は`main`向けの全Pull Requestで実行し、check名が必ず存在するようにします。`scripts/classify-ci-changes.mjs`がself-hostingへ影響する変更かを判定し、無関係な変更では高コストなbootstrap proofを実行せず、明示的な`omitted` summaryを生成して成功します。

self-hostingへ影響する変更では、Pull Requestのexact headについて次をすべて要求します。

1. `run-selfhost-release-gate.mjs`で、固定Seed検証、fixed-Seed Stage 2/3固定点、clean dependency-offline bootstrap、Legacy rollback、step間のgeneration bindingが成功すること。
2. 独立runner上でperturbed environment profileのclean bootstrapをもう1回実行すること。
3. `compare-selfhost-clean-bootstrap-evidence.mjs`で、baseline/perturbed間のrepository commit、lockfile、Seed、Stage 1/2/3、candidate artifact digestが一致すること。
4. `run-selfhost-required-gate.mjs`でrelease-coreとcross-runner evidenceを同じcompiler generationかつPull Requestのexact commitへ束縛すること。

機械可読policyは`.github/selfhost-required-gate.json`です。`nightlyShadowAccepted`、`compilerWideRequired`、`productionDefaultAllowed`は意図的にfalseのままとします。CIの成功回数だけを根拠にtrueへ変更してはいけません。Nightly固定点evidenceを別途実物確認し、その後required範囲を明示的に拡大し、内部opt-in経路がrollback-safeであることを確認してからproduction default変更を検討します。

上流evidence jobが失敗した場合、summary jobは古いproofや別commitへフォールバックせずfail-closed結果を記録します。check名の変更、workflowへのpath filter追加、genericなNightly workflow成功をself-host昇格evidenceとして扱うことによる迂回は禁止します。
