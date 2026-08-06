# Full-language inventory dedicated CI design

This document prepares the next implementation slices for Issue #283. It is a design and test contract only. It does not change current workflow execution while full-language readiness is still being established.

Japanese: [INVENTORY_CI_DESIGN_ja.md](INVENTORY_CI_DESIGN_ja.md)

## Sequencing gate

Implementation begins only after the full-language readiness feature is represented by permanent source changes and its temporary bridge is removable. The design must not require another diagnostic-only pull request.

## Target job topology

1. **Metadata and ordinary unit tests** run independently of the full-language inventory.
2. **Self-host inventory** consumes the same verified build artifact and writes canonical inventory and timing evidence.
3. **Main determinism** runs the same engine with two compiler executions after merge to `main`.
4. **Nightly** reuses the engine for determinism, reproducibility, fuzz, and performance evidence.

The inventory engine remains one implementation. Execution frequency is an input, not a forked code path.

## Required-check contract

The dedicated check must always report a terminal result. Path classification may select `required`, `not-required`, or `conservative-required`, but it must not leave a branch-protection check pending because a job was skipped.

- Self-host compiler, project-boundary, inventory-contract, shared TypeScript configuration, package manifest, and lockfile changes are conservative-required.
- Documentation-only and unrelated tool changes may report a successful `not-required` result without executing the inventory.
- The path rules live in one repository-owned classifier and are tested as data.

## Execution-frequency contract

- Pull requests requiring the inventory: one compile validates module coverage, diagnostics, boundary blockers, capability, and readiness.
- `main`: two compiles validate the same readiness facts and byte-stable result equivalence.
- Nightly: two compiles plus longer reproducibility and performance evidence.

A pull request may still request the two-compile mode explicitly when it changes determinism or canonicalization behavior.

## Artifact contract

The job uploads both files even on a failed assertion when generation reached the relevant boundary:

- `.cache/selfhost/full-language-inventory.json`
- `.cache/selfhost/full-language-inventory-timings.json`

The workflow summary includes schema version, exact head SHA, execution mode, source/parsed/checked/emitted counts, diagnostic count, failed phase, and artifact names. Absolute local paths and wall-clock timestamps are not part of deterministic comparison claims.

## Prepared test matrix

Before changing workflow behavior, add tests for:

- path classification: required, not-required, and conservative-required;
- a terminal successful result for the not-required path;
- one-compile and two-compile modes sharing the same validation engine;
- two-compile mode detecting a changed second result;
- failure evidence written before readiness assertions terminate the command;
- build artifact identity mismatch failing closed;
- workflow artifact names and timeout remaining stable;
- no duplicate inventory execution between temporary and permanent paths;
- ordinary unit-test results returning without waiting for inventory completion.

## Merge slices

1. Add path-classification data and tests without changing workflow frequency.
2. Add a dedicated job that still executes the current two-compile mode.
3. Switch pull-request mode to one compile while preserving `main` and Nightly determinism.
4. Remove the temporary bridge and prove there is one canonical inventory producer.
5. Measure before/after feedback latency and total runner time under equivalent inputs.
