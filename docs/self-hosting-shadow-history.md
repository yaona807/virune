# Self-hosting shadow history

[日本語](self-hosting-shadow-history_ja.md)

The bootstrap shadow-history bridge converts candidate-bound Stage 1／Stage 2 shadow reports into deterministic promotion evidence. It is a pure Host component and does not collect GitHub data, run a compiler stage, change a workflow, or promote a compiler.

## Input contract

Version 1 accepts one candidate SHA and a strictly ordered list of shadow runs. Every run contains:

- a unique run ID;
- the same 40- or 64-character candidate SHA;
- a canonical ISO completion timestamp;
- a canonical version 1 shadow report;
- the SHA-256 of that report.

The bridge verifies the report property order and SHA-256, requires the exact Stage 1 → Stage 2 subject pair, validates the shadow-report status and section summaries, and rejects unknown properties, duplicate run IDs, stale candidates, and non-canonical ordering.

## History semantics

The result records:

- the number of consecutive passing runs ending at the latest run;
- the number of distinct UTC dates represented by that trailing streak;
- the total unexplained differential count across the candidate history;
- the first timestamp in the trailing streak;
- the latest report identity;
- a compact canonical record for every run.

Multiple runs on the same UTC date increase the successful-run count but do not inflate observation days. A mismatch ends the trailing streak. A mismatch anywhere in the candidate history also keeps the generated evidence failed because unexplained differentials must remain zero.

## Promotion evidence

The bridge emits a `PromotionEvidenceObservation` compatible with the existing fail-closed evaluator. It contributes exactly one evidence item:

- ID: `stage1-stage2`
- status: `passed` only when the latest report passes and the candidate history contains no unexplained differences
- candidate: the exact input candidate SHA
- source: the latest shadow-report SHA-256
- completion time: the latest canonical run timestamp

Manual approval, rollback evidence, and stable release cycles remain false／zero. Separate reviewed processes must supply those facts.

## Boundaries

This capability does not:

- execute Stage 1 or Stage 2;
- fetch, persist, or attest GitHub Actions evidence;
- modify Nightly, required checks, or branch protection;
- approve promotion or switch the production compiler;
- alter the grammar, stable Compiler API, Runtime ABI, Interop ABI, or public standard library.
