# Full-languageセルフホストInventory

CanonicalなFull-language Inventoryは、生成済みStage 0 Project CompilerのReadinessを確認するRepository-owned Gateである。ViruneのCanonicalなセルフホストSourceをすべてParse・Check・Emitできるかを検証し、残存Diagnosticを集約し、Project Compiler境界の回帰を失敗として検出する。

## コマンド

```bash
npm run selfhost:inventory
npm run selfhost:inventory:built
npm run selfhost:inventory -- --json
npm run selfhost:inventory -- --compile-runs=1
npm run selfhost:inventory -- --compile-runs=2
npm run selfhost:inventory -- --output=.cache/selfhost/custom-inventory.json
npm run selfhost:inventory -- --timing-output=.cache/selfhost/custom-timings.json
```

`selfhost:inventory`はRepositoryをBuildしてからInventoryを実行する。`selfhost:inventory:built`は既存Buildを再利用する。既定の出力先は次の通りである。

- Inventory: `.cache/selfhost/full-language-inventory.json`
- Phase別Timing: `.cache/selfhost/full-language-inventory-timings.json`

正常終了には次の2状態がある。

- `incomplete`: Project Compiler境界は正常だが、Language loweringのDiagnosticが残っている
- `ready`: Canonical source setがDiagnosticなしで受理され、正常にEmitされている

どちらもExit code 0とする。Build失敗、不正なCompiler出力、Parser／Checker到達率の低下、未知Source参照、Metadata順序違反、Capability矛盾、出力Path違反、2回実行時の非決定性は非0で失敗する。

## 単一の検証Engine

Inventoryは内部的に次の3層へ分離する。

- `full-language-inventory.ts`: Machine-readable modelの検証とCanonical化
- `full-language-inventory-runner.ts`: MVP CompilerのBuild、Stage 0 CandidateのMaterialize／Load、1回または2回のCompile、Inventoryへの変換
- `run-selfhost-full-language-inventory.mjs`: Repository CLIとInventory／Timing Evidenceの書き出し

統合TestとCLIは同じRunnerを利用する。1回実行と2回実行は同じ実装への入力であり、別の検証経路へ分岐しない。

## 実行Mode

1回CompileではSource到達、Diagnostic、Project boundary blocker、Capability、Readiness、Emitted module数を検証する。2回Compileでは同じ検証に加え、結果全体の決定的一致を要求する。

- Pull requestのInventory Gate: 既定で1回Compile
- `main`、Pull request以外のCI Event、Nightly、CLI既定値: 2回Compile
- `--compile-runs=1`／`--compile-runs=2`: Repository CLIで明示指定

Mode resolverは`1`または`2`以外を受理せず、安全側で失敗する。

## 決定性と実行分離

Canonical Inventory JSONには処理時間、Absolute path、Temporary directory名を含めない。同じCommitとSource setに対する2回実行では、Canonicalな結果が一致しなければならない。

各実行は専用の`.test-tmp/selfhost-inventory-*` Directoryを作成し、自分が作成したDirectoryだけを削除する。並行するTestやCommandが互いのTemporary stateを削除しない。

Inventoryでは次を検証する。

- Parsed／Checked module数がCanonical source数と一致する
- Emitted module統計が実際の返却Module数と一致する
- DiagnosticがCanonical source以外を参照しない
- Dependency、Exported symbol、Capability blockerがCanonical順である
- 廃止済み`SHP2001` Project-linking placeholderが再発しない
- Capability stateと`incomplete`／`ready`が矛盾しない

## CI構成

Full-language Inventoryは通常のCore Test収集対象には含めない。CIはCanonical Build Artifactを再利用し、残りのQuality Laneと並列に、専用の`Self-host full-language inventory` Jobで実行する。

Repository-ownedのChanged-path Classifierは`selfhost_inventory_required`を出力する。

- `true`: Canonical Inventoryを実行する
- `false`: 高コストなInventoryを実行せず、明示的な省略記録を残して成功する
- 値の欠落または不正: 省略を受理する前にGateを失敗させる

Job自体はDocumentation以外のすべてのCIで可視かつTerminalな結果を返す。`release-artifacts`は引き続きInventory Jobの成功を要求するため、Path分類による省略でRequired checkがPendingになったり、Release Gateを迂回したりしない。

CI統合TestはCanonical Inventory Evidenceを`.cache/ci-timings/selfhost-full-language-inventory.json`へ書き出し、専用JobはInventory Evidence、Command Timing、Failure EvidenceをArtifactとして保持する。

## 廃止済みReadiness Bridge

PR #279では、PermanentなReadiness変更を準備する間だけ、次の3ファイルをDiagnostic用途で使用した。

- `.github/scripts/tmp-apply-full-language-readiness.py`
- `.github/workflows/tmp-selfhost-full-language-readiness-pr.yml`
- `.github/workflows/tmp-selfhost-full-language-readiness.yml`

これらはPermanent stackには含めない。RepositoryのTemporary-artifact PolicyはTracked treeがCleanであることを要求し、上記の正確なPathを対象とする回帰Testを持つ。Full-language InventoryのCanonicalな生成元は専用CI Jobだけであり、Temporary bridgeを復活させてはならない。

生成したInventory／Timing JSONはEvidenceであり、RepositoryへCommitしない。
