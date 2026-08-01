# Stage 1 and Stage 2 bootstrap readiness

The readiness evaluator verifies the last honest precondition before real Stage 1／Stage 2 generation.

The existing generated Self-host MVP candidate exports `compileMvp(source: string)`. Its Host adapter intentionally accepts exactly one source module. The Self-host compiler project itself is multi-module, so that boundary cannot generate a truthful Stage 1 artifact for the complete compiler.

## What the evaluator does

- builds and normalizes the actual Stage 0 compiler artifact;
- materializes and loads the generated Stage 0 entry module;
- constructs the complete canonical Kernel Contract input from every project source;
- binds the input to the canonical source-manifest SHA-256;
- checks for the required `compileProjectMvp` export;
- emits deterministic, non-promotable readiness evidence.

The evidence claim is `stage1-stage2-bootstrap-readiness`, and `productionEligible` is always `false`.

## Current result

The current Self-host MVP is expected to report both blockers:

- `multi-module-project-requires-project-compiler`;
- `project-compiler-export-missing`.

This result is a successful fail-closed check, not a Stage 1 failure and not a Stage 1 artifact. It prevents the single-source compiler from being mislabeled as self-hosted.

## Required next implementation

The generated compiler candidate must expose a versioned `compileProjectMvp` boundary that consumes the complete canonical source set, module graph, entry path, and emit options. After that export is implemented, the same readiness gate becomes green and the bootstrap runner can perform Stage 0→Stage 1→Stage 2 generation with Stage 1／Stage 2 artifact equivalence.

## Boundaries

This evaluator does not generate Stage 1 or Stage 2, switch the Production Parser／Checker, update the fixed Seed, alter workflows or branch protection, or authorize promotion.
