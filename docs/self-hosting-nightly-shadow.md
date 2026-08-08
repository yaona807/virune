# Self-hosting Nightly execution evidence

[日本語](self-hosting-nightly-shadow_ja.md)

The Nightly self-host job runs the executable Stage 0 compiler probe, the pinned fixed-Seed Stage 1 → Stage 2 transition and Stage 2 → Stage 3 fixed-point shadow, and the existing Self-host MVP differential suite. It uploads the resulting evidence for inspection.

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

After the Stage 0 probe, Nightly executes `run-selfhost-fixed-seed-bootstrap.mjs` against the pinned Seed. The runner verifies the Seed, generates Stage 1, Stage 2, and Stage 3 from the same current Self-host source, and writes:

- `.cache/selfhost-nightly-shadow/fixed-seed-bootstrap.json`;
- `.cache/selfhost-nightly-shadow/fixed-seed-bootstrap.progress.json`.

The fixed-Seed evidence uses the claim `fixed-seed-bootstrap-fixed-point` and always records `productionEligible: false`. It reports the verified Seed hashes, normalized Stage 1 / Stage 2 / Stage 3 hashes and module counts, the Stage 1 → Stage 2 transition differences, and the Stage 2 → Stage 3 fixed-point comparison.

Stage 1 → Stage 2 is **transition evidence** from the historical Seed generator to the current Self-host generator. Differences are recorded and remain visible, but they are not by themselves a fixed-point failure.

The fixed-point requirement is **Stage 2 == Stage 3**. The runner succeeds only when the normalized Stage 2 and Stage 3 artifacts are equivalent and have the same SHA-256; otherwise it writes evidence and fails closed.

## Failure semantics

The Stage 0 probe fails when:

- the accepted input is rejected;
- the rejected input is accepted;
- the two probes execute different compiler artifacts;
- the candidate SHA or run metadata is malformed;
- the Stage 0 compiler candidate cannot be built, materialized, imported, or executed.

The fixed-Seed step fails closed when the pinned Seed cannot be verified or loaded, a required stage cannot be generated or executed, or Stage 2 and Stage 3 do not reach the exact normalized fixed point. Stage 1 → Stage 2 differences remain transition evidence and do not independently fail the fixed-point check.

The Nightly self-host job is deliberately non-blocking (`continue-on-error: true`). Later MVP evidence and artifact upload use `always()`, so failed shadow evidence remains inspectable without becoming a required pull-request check or switching the production compiler.

## Boundary

This job records non-promotable shadow evidence. It does not approve a compiler, change branch protection, modify the fixed Seed, switch the production default, or alter the grammar, stable Compiler API, Runtime ABI, Interop ABI, or public standard library.

Production promotion remains a separate fail-closed decision governed by #99 and its candidate-bound evidence. Nightly success alone never makes an artifact production-eligible.
