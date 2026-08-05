# Self-hosting development operations

This document defines the repository-owned operating rules for Virune self-hosting pull requests. It complements the technical quality gates. It does not relax compiler, compatibility, security, reproducibility, or release requirements.

Japanese: [README_ja.md](README_ja.md)

## Principles

1. Keep one reviewable intent per pull request.
2. Prefer permanent repository commands over temporary workflows or diagnostic-only pull requests.
3. Preserve an exact explanation of dependencies, validation, and temporary artifacts in the pull request.
4. Do not use history repair to hide an unclear feature diff.
5. Do not merge while a required failure is unexplained.

## Stacked pull requests

A stacked pull request is allowed only when all of the following are true:

- the child cannot be implemented or meaningfully validated against `main` alone;
- the dependency is a real source or test dependency, not merely a convenient branch order;
- the parent scope is stable enough that rebuilding the child is bounded;
- the parent pull request, stack position, and overlapping paths are recorded in the child description;
- an independent `main`-based lane would create a larger or less reviewable change.

Do not stack work merely to obtain CI execution, avoid a merge conflict, share temporary diagnostics, or keep several logically independent changes on one branch chain.

### Maximum depth

The normal maximum is **two open levels**: one parent and one child.

A third open level requires an explicit justification in every affected pull request and evidence that no safe two-level or `main`-based decomposition exists. Four or more open levels are prohibited.

## After the parent merges

Do not create a zero-change or ancestry-only pull request to reconnect history.

Use this sequence:

1. stop writes to the child branch;
2. fetch the new `main` and record its commit SHA;
3. create a replacement branch from that exact `main` commit;
4. cherry-pick or reapply only the child's feature commits;
5. compare the replacement diff with the intended changed-path list;
6. rerun the repository-owned focused validation and the ordinary pull-request gates;
7. update the existing pull request safely, or close it as superseded and open one replacement pull request when its head cannot be updated without history-only commits.

A merge commit whose only purpose is ancestry repair is not feature evidence and must not be introduced into `main`.

## Repository-owned diagnostic entry points

Use these commands before designing a temporary execution path:

```bash
npm run selfhost:inventory
npm run selfhost:focused -- --list
npm run selfhost:focused -- --case=<case-id>
npm run selfhost:reconstruct -- --list
npm run selfhost:reconstruct -- --case=<case-id>
```

- `selfhost:inventory` owns canonical full-language inventory evidence.
- `selfhost:focused` owns one registered generated-compiler regression.
- `selfhost:reconstruct` owns one registered historical reconstruction with fixed commit and path identities.

A new recurring diagnostic should extend one of these commands or add another repository-owned command. It should not remain embedded only in a workflow file.

## Temporary workflows and diagnostic-only pull requests

A temporary execution mechanism is an exception. It is allowed only when all of the following are documented:

- no existing repository command can execute the required validation;
- the exact reason a permanent command cannot be added in the same slice;
- the fixed branch, paths, permissions, and expected output;
- the removal trigger and responsible pull request;
- confirmation that the temporary change is not intended for merge;
- confirmation that it does not weaken or bypass any existing gate.

Temporary workflow files must be removed before the feature pull request becomes ready for review. A diagnostic-only pull request must be closed after its evidence has been replaced by a permanent command or is no longer needed.

## CI failure classification

Classify a failure before retrying or modifying the feature.

| Class | Evidence | Required action |
| --- | --- | --- |
| Feature regression | Reproduces on the pull-request head and is attributable to the changed behavior or files | Fix the change and add or retain regression coverage |
| Shared infrastructure | The same failure occurs on unchanged code or multiple unrelated pull requests, with matching logs | Record the shared evidence and retry only after the dependency or service recovers |
| Retryable transient | A bounded external failure such as a runner startup, rate limit, or artifact transport failure; no test assertion failed | Retry once with the original head SHA; repeated failure requires investigation |
| Unknown | Evidence is insufficient or classifications conflict | Do not retry blindly; collect logs and reduce the failure to one of the other classes |

A failed test, compiler diagnostic mismatch, compatibility check, security check, or reproducibility check is never classified as transient merely because a rerun might pass.

## Pull-request evidence

Every self-hosting pull request must state:

- change classification and one-sentence intent;
- base branch and exact dependency, or `none`;
- stack depth and why a stack is required, or `not stacked`;
- intended changed paths or boundaries;
- repository-owned commands executed and their results;
- current CI failure classification, if any;
- temporary artifacts, their removal trigger, and merge disposition, or `none`;
- remaining work intentionally excluded from the pull request.

Use the repository template in `.github/PULL_REQUEST_TEMPLATE/self-hosting.md`.

## Inventory-only changes

Inventory generation and feature implementation may share an engine, but a pull request should not mix generated evidence churn with unrelated compiler behavior.

- Change the inventory model or command when its contract changes.
- Change expected inventory assertions with the feature that intentionally changes the result.
- Do not commit transient inventory output unless it is a versioned repository contract.
- Store ordinary run evidence as CI artifacts or pull-request text, not as permanent source files.

## Completion

A self-hosting operations change is complete only when:

- its permanent command or policy is on `main`;
- all required workflow families pass on the exact merged head;
- superseded diagnostic-only pull requests are closed;
- temporary workflow files are absent;
- Issue #269 records the result and remaining phase work.
