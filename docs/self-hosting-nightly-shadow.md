# Self-hosting Nightly execution evidence

[日本語](self-hosting-nightly-shadow_ja.md)

The Nightly self-host job runs the executable Stage 0 compiler probe, the Stage 1 / Stage 2 bootstrap shadow, and the existing Self-host MVP differential suite, then uploads their artifacts for inspection.

## Evidence produced

The Stage 0 runner executes two canonical Kernel Contract v1 inputs through the same materialized compiler artifact:

- an accepted program that returns `42`;
- a rejected program that references an unknown name.

It stores:

- the normalized Stage 0 compiler artifact and its SHA-256;
- accepted and rejected probe evidence with SHA-256 files;
- a run manifest bound to the GitHub candidate SHA and workflow run ID;
- the existing MVP differential report in the same workflow artifact.

The Stage 0 run manifest uses the claim `nightly-stage0-compiler-execution-probe` and always records `productionEligible: false`.

After the Stage 0 probe, Nightly executes the repository-owned `selfhost:bootstrap:built` runner. It evaluates the checked-in Stage readiness witnesses, builds the canonical Self-host project, executes Stage 1 and Stage 2 through real emitted artifacts when readiness permits, and writes `.cache/selfhost-nightly-shadow/bootstrap-stages.json`.

That JSON evidence uses the claim `stage1-stage2-bootstrap`, always records `productionEligible: false`, and reports:

- readiness evidence and its SHA-256;
- Stage 1 and Stage 2 normalized artifact SHA-256 values and module counts when executed;
- `blocked`, `match`, or `mismatch` status;
- canonical per-module differences when the normalized artifacts do not match.

## Failure semantics

The Stage 0 probe fails when:

- the accepted input is rejected;
- the rejected input is accepted;
- the two probes execute different compiler artifacts;
- the candidate SHA or run metadata is malformed;
- the Stage 0 compiler candidate cannot be built, materialized, imported, or executed.

The Stage 1 / Stage 2 bootstrap step writes its JSON evidence before failing when readiness is blocked or the normalized artifacts differ. It also fails closed when the project cannot be built or a ready Stage compiler cannot be executed or materialized.

The Nightly self-host job is deliberately non-blocking (`continue-on-error: true`). Later evidence steps and artifact upload use `always()`, so a failed Stage 0 or Stage 1 / Stage 2 probe remains inspectable without becoming a required pull-request check or switching the production compiler.

## Boundary

This job records Stage 0 and Stage 1 / Stage 2 shadow evidence, but none of those artifacts approve or promote a compiler. They do not change branch protection, modify the fixed Seed, switch the production default, or alter the grammar, stable Compiler API, Runtime ABI, Interop ABI, or public standard library.

Promotion remains a separate fail-closed Host decision governed by the checked-in promotion policy and candidate-bound evidence.
