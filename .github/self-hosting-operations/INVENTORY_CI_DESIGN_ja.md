# Full-language inventory専用CI設計

この文書はIssue #283の次の実装Sliceを準備する設計・Test contractである。Full-language readiness確立中の現行Workflow実行は変更しない。

English: [INVENTORY_CI_DESIGN.md](INVENTORY_CI_DESIGN.md)

## Sequencing Gate

Full-language readinessがPermanent source変更として確定し、Temporary bridgeを撤去可能になった後だけ実装を開始する。新しい診断専用Pull Requestを前提にしない。

## 目標Job topology

1. **Metadataと通常Unit test**はFull-language inventoryと独立して実行する。
2. **Self-host inventory**は同じ検証済みBuild artifactを使用し、Canonical inventoryとTiming evidenceを出力する。
3. **Main determinism**は`main`へのMerge後に同じEngineを2回実行する。
4. **Nightly**は同じEngineをDeterminism、Reproducibility、Fuzz、Performance evidenceへ再利用する。

Inventory engineは1実装を維持する。実行回数はInputであり、別実装へ分岐しない。

## Required check contract

専用Checkは必ずTerminal resultを返す。Path分類は`required`、`not-required`、`conservative-required`を選べるが、Job skipによってBranch protection checkをPendingのまま残さない。

- Self-host Compiler、Project boundary、Inventory contract、共通TypeScript設定、Package manifest、Lockfile変更はConservative-requiredとする。
- Documentation-onlyまたは無関係なTool変更はInventoryを実行せず、成功した`not-required`結果を返せる。
- Path ruleは1つのRepository-owned classifierへ集約し、DataとしてTestする。

## 実行頻度Contract

- Inventory必須Pull Request: 1回CompileでModule coverage、Diagnostic、Boundary blocker、Capability、Readinessを検証する。
- `main`: 2回Compileで同じReadiness factsとResult equivalenceを検証する。
- Nightly: 2回Compileに加え、長時間Reproducibility・Performance evidenceを取得する。

DeterminismまたはCanonicalization behaviorを変更するPull Requestは、明示的に2回Modeを要求できる。

## Artifact contract

Generationが対象Boundaryへ到達した場合、Assertion失敗時も次の両FileをUploadする。

- `.cache/selfhost/full-language-inventory.json`
- `.cache/selfhost/full-language-inventory-timings.json`

Workflow summaryにはSchema version、正確なHead SHA、Execution mode、Source／Parsed／Checked／Emitted件数、Diagnostic件数、失敗Phase、Artifact名を含める。Absolute local pathとWall-clock timestampはDeterministic comparison claimへ含めない。

## 事前Test matrix

Workflow behavior変更前に次をTestする。

- Path分類のRequired、Not-required、Conservative-required。
- Not-required pathでもTerminal successを返すこと。
- 1回Modeと2回Modeが同じValidation engineを共有すること。
- 2回Modeで2回目Result差分を検出すること。
- Readiness assertion終了前にFailure evidenceを保存すること。
- Build artifact identity不一致でFail closedすること。
- Workflow artifact名とTimeoutが安定していること。
- Temporary pathとPermanent pathでInventoryを二重実行しないこと。
- 通常Unit test結果がInventory完了を待たず返ること。

## Merge Slice

1. Workflow頻度を変えず、Path分類DataとTestを追加する。
2. 現行2回Modeのまま専用Jobへ分離する。
3. Pull Requestだけ1回Modeへ変更し、`main`とNightlyのDeterminismを維持する。
4. Temporary bridgeを撤去し、Canonical inventory producerが1つであることを証明する。
5. 同等Inputで変更前後のFeedback latencyと総Runner timeを測定する。
