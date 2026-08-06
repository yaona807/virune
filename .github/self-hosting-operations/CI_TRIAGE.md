# Self-hosting CI triage and temporary-artifact runbook

This runbook turns the self-hosting operating rules into repeatable repository commands. It does not weaken compiler, compatibility, security, reproducibility, or release gates.

Japanese: [CI_TRIAGE_ja.md](CI_TRIAGE_ja.md)

## 1. Freeze the evidence identity

Before retrying or changing code, record all of the following in the pull request:

- exact head commit SHA;
- workflow run ID and job ID;
- failing step and the first relevant error;
- whether a test assertion, compiler diagnostic comparison, compatibility gate, security gate, or reproducibility gate failed;
- any matching failure on unchanged code or unrelated pull requests.

Do not compare runs from different head SHAs as though they were one attempt.

## 2. Produce machine-readable classification evidence

Create an input file outside the tracked source tree, for example `.cache/selfhost/ci-failure-input.json`:

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

Validate and normalize it:

```bash
node scripts/classify-selfhost-ci-failure.mjs \
  --input .cache/selfhost/ci-failure-input.json \
  --output .cache/selfhost/ci-failure.json
```

Supported classifications:

- `feature-regression` requires reproduction on the exact head and attribution to changed behavior or files;
- `shared-infrastructure` requires matching evidence on unchanged code or unrelated pull requests;
- `retryable-transient` requires a bounded external failure, permits only one retry on the exact head, and is rejected for assertion, diagnostic, compatibility, security, or reproducibility failures;
- `unknown` blocks blind retries until more evidence is collected.

Attach or summarize the normalized output in the pull request. Do not commit ordinary run evidence.

## 3. Retry rules

A retry is allowed only when the normalized evidence contains `"retryAllowed": true`.

- Retry the exact same head SHA once.
- Do not combine a retry with source, workflow, dependency, or configuration changes.
- If the same failure repeats, update the evidence with `repeatedOnSameHead: true`; it is no longer transient.
- A green rerun does not erase an unexplained assertion or gate failure from the original run.

## 4. Temporary-artifact declaration

Temporary workflow and script names are restricted to reviewed locations and naming rules:

- `.github/workflows/tmp-*`;
- `.github/scripts/tmp-*`;
- `scripts/tmp-*`;
- files ending in `.temporary.mjs`, `.temporary.cjs`, `.temporary.js`, `.temporary.ts`, `.temporary.json`, `.temporary.yml`, or `.temporary.yaml` in those directories.

Every tracked temporary artifact must have one matching entry in `.github/self-hosting-operations/temporary-artifacts.json`:

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

Validate declarations against tracked files:

```bash
node scripts/verify-selfhost-temporary-artifacts.mjs
```

The check fails for undeclared files, stale registry rows, duplicate IDs or paths, invalid repository-relative paths, or any merge disposition other than `do-not-merge`.

## 5. Merge-clean check

Before a feature pull request becomes ready for review, and again immediately before merge, require a clean tree:

```bash
node scripts/verify-selfhost-temporary-artifacts.mjs --require-clean
```

This command fails while any declared temporary artifact remains. Removing the file without removing its registry row also fails.

## 6. Clean-clone handoff verification

Use a clean clone or disposable worktree and the exact pull-request head:

```bash
npm ci
npm run verify:metadata
node scripts/verify-selfhost-temporary-artifacts.mjs --require-clean
npm run selfhost:focused -- --list
npm run selfhost:focused -- --case=contract
npm run selfhost:reconstruct -- --list
npm run smoke:clone
```

For a self-host compiler change, also execute the relevant inventory or bootstrap command required by the pull request. Record the exact command, head SHA, and output artifact identity. Do not treat a previous branch's result as clean-clone evidence for a replacement branch.

## 7. Closure checklist

A diagnostic exception is closed only when all of the following are true:

- permanent repository commands reproduce the required evidence;
- temporary files and registry entries are removed;
- diagnostic-only pull requests are closed without merge;
- the feature pull request passes the merge-clean check;
- required workflows pass on the exact merge candidate;
- Issue #269 records the permanent replacement and remaining work.
