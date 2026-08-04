# Full-languageセルフホストInventory

CanonicalなFull-language Inventoryは、生成済みStage 0 Project Compilerの状態を確認するRepository-owned診断コマンドである。ViruneのセルフホストSourceをすべてParse・Checkできるかを確認し、残存Diagnosticを集約し、Project Compiler境界の回帰を失敗として検出する。

## コマンド

```bash
npm run selfhost:inventory
npm run selfhost:inventory:built
npm run selfhost:inventory -- --json
npm run selfhost:inventory -- --output=.cache/selfhost/custom-inventory.json
```

`selfhost:inventory`はRepositoryをBuildしてからInventoryを実行する。`selfhost:inventory:built`は既存Buildを再利用する。既定のJSON出力先は`.cache/selfhost/full-language-inventory.json`である。

正常終了には次の2状態がある。

- `incomplete`: Project Compiler境界は正常だが、Language loweringのDiagnosticが残っている
- `ready`: Canonical source setがDiagnosticなしで受理され、正常にEmitされている

どちらもExit code 0とする。Build失敗、不正なCompiler出力、反復実行の非決定性、Parser／Checker到達率の低下、未知Source参照、Metadata順序違反、Capability矛盾、出力Path違反は非0で失敗する。

## 単一実装

Inventoryは内部的に次の3層へ分離する。

- `full-language-inventory.ts`: Machine-readable modelの検証とCanonical化
- `full-language-inventory-runner.ts`: MVP CompilerのBuild、Stage 0 Candidate生成、同一Requestの2回実行、Inventory返却
- `run-selfhost-full-language-inventory.mjs`: Repository CLI

統合TestとCLIは同じRunnerを利用する。CLIからTest Processを呼び出さず、Inventoryロジックも複製しない。

## 決定性と実行分離

JSONには実行日時、処理時間、Absolute path、Temporary directory名を含めない。同じCommitとSource setであれば、反復出力はByte単位で一致する。

各実行は専用の`.test-tmp/selfhost-inventory-*` Directoryを作成し、自分が作成したDirectoryだけを削除する。並行するTestやCommandが互いのTemporary stateを削除しない。

Inventoryでは次を検証する。

- Parsed／Checked module数がCanonical source数と一致する
- Emitted module統計が実際の返却Module数と一致する
- DiagnosticがCanonical source以外を参照しない
- Dependency、Exported symbol、Capability blockerがCanonical順である
- 廃止済み`SHP2001` Project-linking placeholderが再発しない
- Capability stateと`incomplete`／`ready`が矛盾しない

## CI Evidence

既存の統合Testは決定的なEvidenceを`.cache/ci-timings/selfhost-full-language-inventory.json`へ書き出す。既存Core TestのArtifact uploadがこのDirectoryを保持するため、追加Workflowや900秒級Inventoryの二重実行は導入しない。

生成JSONは診断Evidenceであり、RepositoryへCommitしない。
