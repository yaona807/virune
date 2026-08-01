# Self-hosting Nightly execution evidence

[日本語](self-hosting-nightly-shadow_ja.md)

The Nightly self-host job runs the executable Stage 0 compiler probe and the existing Self-host MVP differential suite, then uploads their artifacts for inspection.

## Evidence produced

The runner executes two canonical Kernel Contract v1 inputs through the same materialized compiler artifact:

- an accepted program that returns `42`;
- a rejected program that references an unknown name.

It stores:

- the normalized compiler artifact and its SHA-256;
- accepted and rejected probe evidence with SHA-256 files;
- a run manifest bound to the GitHub candidate SHA and workflow run ID;
- the existing MVP differential report in the same workflow artifact.

The run manifest uses the claim `nightly-stage0-compiler-execution-probe` and always records `productionEligible: false`.

## Failure semantics

The runner fails when:

- the accepted input is rejected;
- the rejected input is accepted;
- the two probes execute different compiler artifacts;
- the candidate SHA or run metadata is malformed;
- the Stage 0 compiler candidate cannot be built, materialized, imported, or executed.

The Nightly job is deliberately non-blocking. Failures remain visible in the workflow and uploaded evidence, but they do not become a required pull-request check or switch the production compiler.

## Boundary

This job does not generate or claim Stage 1 or Stage 2. It does not provide promotion evidence, approve a compiler, change branch protection, modify the fixed Seed, or alter the grammar, stable Compiler API, Runtime ABI, Interop ABI, or public standard library.

A later bootstrap stage must let an executable candidate compile the canonical multi-module Self-host source manifest. Only that output can be called Stage 1 and enter the Stage 1／Stage 2 shadow-history pipeline.
