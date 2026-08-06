# Self-hosting CI障害診断・Temporary artifact運用Runbook

このRunbookは、Self-hosting運用規則を再実行可能なRepository commandへ落とし込む。Compiler、互換性、Security、再現性、Release Gateは緩和しない。

English: [CI_TRIAGE.md](CI_TRIAGE.md)

## 1. Evidence identityを固定する

RetryまたはCode変更の前に、Pull Requestへ次を記録する。

- 正確なHead Commit SHA。
- Workflow run IDとJob ID。
- 失敗Stepと最初の関連Error。
- Test assertion、Compiler diagnostic比較、Compatibility Gate、Security Gate、Reproducibility Gateのどれが失敗したか。
- Unchanged codeまたは無関係なPull Requestで同じFailureが発生したEvidence。

Head SHAが異なるRunを同一Attemptとして比較しない。

## 2. Machine-readableな分類Evidenceを生成する

Tracked source外にInput fileを作成する。例: `.cache/selfhost/ci-failure-input.json`。

```json
{
  "schemaVersion": 1,
  "headSha": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "workflow": "CI",
  "runId": 123,
  "jobId": 456,
  "classification": "unknown",
  "evidence": {
    "reproducesOnHead": false,
    "attributableToChangedBehaviorOrFiles": false,
    "sameFailureOnUnchangedCode": false,
    "sameFailureOnUnrelatedPullRequests": false,
    "boundedExternalFailure": false,
    "testAssertionFailed": false,
    "compilerDiagnosticMismatch": false,
    "compatibilityFailure": false,
    "securityFailure": false,
    "reproducibilityFailure": false,
    "repeatedOnSameHead": false
  }
}
```

検証・正規化する。

```bash
node scripts/classify-selfhost-ci-failure.mjs \
  --input .cache/selfhost/ci-failure-input.json \
  --output .cache/selfhost/ci-failure.json
```

対応する分類:

- `feature-regression`: 正確なHeadでの再現と、変更したBehaviorまたはFileへの帰属が必要。
- `shared-infrastructure`: Unchanged codeまたは無関係なPull Requestで一致するEvidenceが必要。
- `retryable-transient`: 限定的な外部Failureだけを対象とし、同一Headで1回だけRetry可能。Assertion、Diagnostic、Compatibility、Security、Reproducibility failureでは拒否する。
- `unknown`: Evidenceが揃うまでBlind retryを禁止する。

正規化後の出力をPull Requestへ添付または要約する。通常のRun evidenceはCommitしない。

## 3. Retry規則

正規化Evidenceに`"retryAllowed": true`がある場合だけRetryする。

- 正確に同じHead SHAを1回だけRetryする。
- Retryと同時にSource、Workflow、Dependency、Configurationを変更しない。
- 同じFailureが再発した場合は`repeatedOnSameHead: true`へ更新し、Transient扱いを終了する。
- Green rerunを理由に、元Runの未説明AssertionまたはGate failureを消去しない。

## 4. Temporary artifactの宣言

Temporary workflowとScriptは、次のReviewed location・Naming ruleだけを対象とする。

- `.github/workflows/tmp-*`
- `.github/scripts/tmp-*`
- `scripts/tmp-*`
- 上記Directory内の`.temporary.mjs`、`.temporary.cjs`、`.temporary.js`、`.temporary.ts`、`.temporary.json`、`.temporary.yml`、`.temporary.yaml`

Tracked temporary artifactは、`.github/self-hosting-operations/temporary-artifacts.json`へ1件ずつ対応するEntryを持つ。

```json
{
  "schemaVersion": 1,
  "artifacts": [
    {
      "id": "readiness-probe",
      "path": ".github/workflows/tmp-readiness.yml",
      "responsiblePullRequest": 279,
      "removalTrigger": "Canonical readiness evidence is available from the permanent command.",
      "mergeDisposition": "do-not-merge"
    }
  ]
}
```

Tracked fileと宣言を照合する。

```bash
node scripts/verify-selfhost-temporary-artifacts.mjs
```

未宣言File、存在しないRegistry row、ID／Path重複、不正なRepository-relative path、`do-not-merge`以外のMerge dispositionを拒否する。

## 5. Merge-clean check

Feature Pull RequestをReady for reviewにする前と、Merge直前にClean treeを要求する。

```bash
node scripts/verify-selfhost-temporary-artifacts.mjs --require-clean
```

宣言済みTemporary artifactが1件でも残る間は失敗する。Fileだけを削除しRegistry rowを残した場合も失敗する。

## 6. Clean clone引継ぎ検証

Clean cloneまたはDisposable worktreeで、正確なPull Request Headを使用する。

```bash
npm ci
npm run verify:metadata
node scripts/verify-selfhost-temporary-artifacts.mjs --require-clean
npm run selfhost:focused -- --list
npm run selfhost:focused -- --case=contract
npm run selfhost:reconstruct -- --list
npm run smoke:clone
```

Self-host Compiler変更では、Pull Requestが要求するInventoryまたはBootstrap commandも実行する。正確なCommand、Head SHA、Output artifact identityを記録する。Replacement Branchに対して以前のBranch結果をClean-clone evidenceとして流用しない。

## 7. 終了Checklist

Diagnostic exceptionは次をすべて満たした場合だけ終了する。

- Permanent repository commandで必要Evidenceを再現できる。
- Temporary fileとRegistry entryを削除した。
- 診断専用Pull RequestをMergeせずCloseした。
- Feature Pull RequestがMerge-clean checkを通過した。
- 正確なMerge candidateでRequired workflowが成功した。
- Issue #269へPermanent replacementとRemaining workを記録した。
