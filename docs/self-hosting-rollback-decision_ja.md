# セルフホスティングrollback判定evidence

Rollback判定Evaluatorは、candidateに結び付いたgate evidenceを、決定論的な運用判定へ変換します。

## Fail-closed規則

Self-host Compilerを維持できるのは、すべての必須gateが存在し、完全に同じcandidate SHA-256へ結び付き、設定された有効期間内で、かつpassしている場合だけです。それ以外ではLegacy Compilerを選択し、rollback必須と判定します。

必須gateは次のとおりです。

- bootstrap determinism
- Legacy compatibility
- runtime behaviour
- performance
- clean bootstrap
- rollback smoke

欠損、期限切れ、失敗、candidate不一致は、明示的かつcanonical順の理由として保持します。入力順序は、直列化された判定およびSHA-256へ影響しません。

## Legacy rollback smoke

依存関係をインストールしたcleanなGit checkoutで、`npm run selfhost:rollback-smoke`を実行します。このコマンドはrepositoryをbuildした後、`performance` gateだけを意図的にfailさせ、Self-host candidateへアクセス不能な状態でrollback selection境界を実行します。成功時には次を実証します。

- rollback判定が実際のLegacy Compiler経路を選択すること
- 利用不能なSelf-host candidateを読み取らず、materializeもしないこと
- canonicalなsmoke programをLegacyで正常にcompileできること
- 証明実行時のtracked／untracked Git working treeがcleanであること

既定では`.cache/selfhost/legacy-rollback-smoke.json`へJSON evidenceを書き込みます。通常のsource-clone smoke laneでもcanonical build後に同じrollback証明を実行し、`.cache/ci-timings/selfhost-legacy-rollback-smoke.json`へ保存するため、CIのtiming evidenceとともに保持されます。

このsmokeは意図的にsyntheticな利用不能candidateを使い、`productionEligible: false`を記録します。証明対象はfallback機構だけであり、candidate昇格evidenceではなく、production defaultを切り替えることもありません。

## 境界

このartifactはevidenceのみです。Compilerの切替、workflow／branch protection変更、production default変更、grammar、stable Compiler API、Runtime ABI、Interop ABI、公開standard libraryの変更は行いません。
