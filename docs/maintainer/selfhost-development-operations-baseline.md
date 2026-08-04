# Self-hosting development operations baseline

Baseline ID: `phase1-baseline-2026-08-05`

Measured at 2026-08-05 JST from the latest 50 pull requests authored by `yaona807` in `yaona807/virune`. The observed creation window was approximately 61.8 hours, from PR #215 through PR #270.

## Summary

| Metric | Baseline |
|---|---:|
| Pull requests | 50 |
| Merged | 48 |
| Open | 2 |
| `feat` | 40 |
| `fix` | 5 |
| `test` | 3 |
| `chore` | 2 |
| Non-feature transport or recovery PRs | 3 (6%) |
| Temporary execution paths | 8 (16%) |
| Explicit stack, dependency-chain, or ancestry usage | at least 8 |
| Explicit rebuild or normalization evidence | at least 6 |

## Operational classification

| Class | Count | Pull requests |
|---|---:|---|
| Feature, correctness, or evidence | 47 | all other PRs in the window |
| History or ancestry repair | 1 | #267 |
| Shared CI or dependency repair | 1 | #266 |
| Diagnostic-only temporary PR | 1 | #268 |

PR #267 was a zero-commit ancestry connection. PR #268 existed only to run reconstruction diagnostics and was explicitly not intended to merge. Both are direct examples of transport cost rather than product change.

## Temporary execution mechanisms

The following PRs explicitly documented a temporary or self-removing workflow:

- #258
- #259
- #261
- #262
- #263
- #264
- #266

Including diagnostic-only PR #268, 8 of 50 PRs required a temporary execution path.

Six of the seven PRs from #258 through #264 used a temporary self-removing workflow. This concentration indicates that focused validation was not reliably available through permanent repository commands or ordinary workflows.

## Stack and reconstruction evidence

At least the following PRs explicitly documented a stack, dependency chain, or ancestry repair:

- #227
- #229
- #261
- #262
- #263
- #264
- #265
- #267

At least six PRs explicitly documented a rebuild, rebuilt branch, or normalization step:

- #217
- #229
- #253
- #265
- #267
- #268

These counts are lower bounds. Final PR metadata cannot reconstruct every rebase, branch rebuild, or parent-merge recovery operation.

## Core file concentration

The representative syntax and semantic self-hosting sample contains these 14 PRs:

`#250, #251, #252, #255, #256, #257, #258, #259, #261, #262, #263, #264, #265, #270`

| Core file | Changed PRs | Ratio |
|---|---:|---:|
| `selfhost/mvp/src/parser.virune` | 11/14 | 79% |
| `selfhost/mvp/src/checker.virune` | 10/14 | 71% |
| `selfhost/mvp/src/emitter.virune` | 9/14 | 64% |
| `selfhost/mvp/src/model.virune` | 5/14 | 36% |

Every sampled PR changed at least one of these files. Independent logical lanes therefore still converge on the same physical conflict points.

## Decisions derived from the baseline

1. Replace diagnostic-only PRs and temporary workflows with repository-owned commands.
2. Define when stacked PRs are allowed and cap their recommended depth.
3. Make inventory, focused self-host tests, and reconstruction diagnostics reproducible from a clean clone.
4. Defer parser, checker, and emitter internal restructuring until the self-hosting critical path is stable.
5. Re-run the same rolling 50-PR measurement without excluding unfavorable cases.

## Reproducing the rolling report

Use a GitHub token with repository read access:

```bash
GITHUB_TOKEN=... node scripts/analyze-selfhost-pr-operations.mjs \
  --repo yaona807/virune \
  --author yaona807 \
  --limit 50
```

To write Markdown and JSON artifacts:

```bash
GITHUB_TOKEN=... node scripts/analyze-selfhost-pr-operations.mjs \
  --repo yaona807/virune \
  --author yaona807 \
  --limit 50 \
  --output selfhost-operations.md \
  --json-output selfhost-operations.json
```

Classification rules are defined in [`selfhost-pr-classification-rules.md`](./selfhost-pr-classification-rules.md). The checked-in baseline is a historical snapshot; regenerated rolling output will change as new PRs are created.
