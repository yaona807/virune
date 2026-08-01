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

## 境界

このartifactはevidenceのみです。Compilerの切替、workflow／branch protection変更、production default変更、grammar、stable Compiler API、Runtime ABI、Interop ABI、公開standard libraryの変更は行いません。
