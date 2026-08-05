# Self-hosting開発運用

この文書は、ViruneのSelf-hosting Pull Requestに適用するRepository-ownedな運用規則を定義する。技術的な品質Gateを補完するものであり、Compiler、互換性、Security、再現性、Release要件を緩和しない。

English: [README.md](README.md)

## 原則

1. 1 Pull Requestにつき、Review可能な目的を1つにする。
2. Temporary workflowや診断専用Pull Requestより、恒久的なRepository commandを優先する。
3. 依存関係、検証経路、Temporary artifactをPull Requestへ正確に記録する。
4. 不明瞭なFeature diffをHistory repairで隠さない。
5. Required failureの原因が説明できない状態でMergeしない。

## Stacked Pull Request

Stacked Pull Requestは、次のすべてを満たす場合だけ使用できる。

- Childを`main`単独に対して実装または有意に検証できない。
- 依存が単なるBranch順序ではなく、実際のSourceまたはTest依存である。
- ParentのScopeが十分安定し、Child再構築の範囲が限定される。
- Childの説明にParent Pull Request、Stack位置、重複Pathを記録する。
- 独立した`main`基準のLaneにすると、変更がより大きくなるかReviewしにくくなる。

CIを実行するため、Merge conflictを避けるため、Temporary diagnosticsを共有するため、または論理的に独立した変更を同じBranch chainへ載せるためだけにStackしない。

### 最大深度

通常の最大は、**Openな2段**、すなわちParent 1件とChild 1件とする。

3段目をOpenにする場合は、影響するすべてのPull Requestへ例外理由と、安全な2段構成または`main`基準へ分解できない根拠を記録する。4段以上のOpen Stackは禁止する。

## Parent Merge後

Historyを接続するためだけのZero-changeまたはAncestry-only Pull Requestを作らない。

次の順序で再構築する。

1. Child Branchへの書込みを停止する。
2. 新しい`main`を取得し、Commit SHAを記録する。
3. その`main` CommitからReplacement Branchを作成する。
4. ChildのFeature CommitだけをCherry-pickまたは再適用する。
5. Replacement diffを意図したChanged-path listと比較する。
6. Repository-owned focused validationと通常のPull Request Gateを再実行する。
7. Existing Pull RequestのHeadを安全に更新する。History-only Commitなしでは更新できない場合は、SupersededとしてCloseし、Replacement Pull Requestを1件だけ作成する。

Ancestry repairだけを目的とするMerge CommitはFeature evidenceではなく、`main`へ入れてはならない。

## Repository-owned diagnostic entry point

Temporary execution pathを設計する前に、次のCommandを使用する。

```bash
npm run selfhost:inventory
npm run selfhost:focused -- --list
npm run selfhost:focused -- --case=<case-id>
npm run selfhost:reconstruct -- --list
npm run selfhost:reconstruct -- --case=<case-id>
```

- `selfhost:inventory`はCanonicalなFull-language inventory evidenceを管理する。
- `selfhost:focused`は登録済みのGenerated Compiler regressionを1件実行する。
- `selfhost:reconstruct`はCommitとPathのIdentityを固定したHistorical reconstructionを1件実行する。

繰り返し必要になる新しい診断は、上記Commandを拡張するか、新しいRepository-owned commandとして追加する。Workflow file内だけに残さない。

## Temporary workflowと診断専用Pull Request

Temporary execution mechanismは例外とする。次のすべてを文書化した場合だけ使用できる。

- 既存Repository commandでは必要な検証を実行できない。
- 同じSliceでPermanent commandを追加できない正確な理由。
- 固定Branch、Path、Permission、期待出力。
- 削除Triggerと責任を持つPull Request。
- Temporary変更をMerge対象にしないこと。
- 既存Gateを弱めたり迂回したりしないこと。

Temporary workflow fileは、Feature Pull RequestをReady for reviewにする前に削除する。診断専用Pull Requestは、EvidenceがPermanent commandへ置き換わった時点、または不要になった時点でCloseする。

## CI failure分類

RetryまたはFeature変更の前に、Failureを分類する。

| 分類 | 根拠 | 必須対応 |
| --- | --- | --- |
| Feature regression | Pull Request Headで再現し、変更したBehaviorまたはFileに帰属できる | 変更を修正し、Regression coverageを追加または維持する |
| Shared infrastructure | Unchanged codeまたは複数の無関係なPull Requestで、同じLogのFailureが発生する | 共通Evidenceを記録し、DependencyまたはService復旧後だけRetryする |
| Retryable transient | Runner起動、Rate limit、Artifact transportなど限定的な外部Failureで、Test assertionは失敗していない | 同じHead SHAで1回だけRetryする。再失敗時は調査する |
| Unknown | Evidence不足または分類が競合する | Blind retryせず、Logを収集して他の分類へ絞り込む |

Test failure、Compiler diagnostic差分、Compatibility、Security、Reproducibility failureは、Rerunで通る可能性だけを理由にTransient扱いしない。

## Pull Request evidence

すべてのSelf-hosting Pull Requestは、次を記載する。

- 変更分類と1文の目的。
- Base Branchと正確な依存関係、または`none`。
- Stack depthとStackが必要な理由、または`not stacked`。
- 意図したChanged pathまたはBoundary。
- 実行したRepository-owned commandと結果。
- CI failureがある場合、その分類。
- Temporary artifact、削除Trigger、Merge disposition、または`none`。
- Pull Requestから意図的に除外したRemaining work。

`.github/PULL_REQUEST_TEMPLATE/self-hosting.md`のRepository templateを使用する。

## Inventory-only変更

Inventory生成とFeature実装は同じEngineを共有できるが、Generated evidenceのChurnと無関係なCompiler behaviorを同じPull Requestへ混在させない。

- Inventory contractが変わる場合は、Inventory modelまたはCommandを変更する。
- Featureが結果を意図的に変える場合は、そのFeatureと一緒にExpected inventory assertionを変更する。
- Versioned Repository contractでない一時的なInventory outputをCommitしない。
- 通常のRun evidenceはPermanent source fileではなく、CI artifactまたはPull Request本文へ保存する。

## 完了条件

Self-hosting運用改善は、次をすべて満たした時点で完了する。

- Permanent commandまたはPolicyが`main`へ入っている。
- Merge対象HeadのすべてのRequired workflow familyが成功している。
- Supersededな診断専用Pull RequestがCloseされている。
- Temporary workflow fileが残っていない。
- Issue #269へ結果と残るPhase作業が記録されている。
