# Full-language Self-host Inventory

The canonical full-language inventory is the repository-owned readiness check for the generated Stage 0 project compiler. It verifies that every canonical Virune self-host source can be parsed, checked, and emitted, groups any remaining diagnostics, and rejects project-compiler boundary regressions.

## Commands

```bash
npm run selfhost:inventory
npm run selfhost:inventory:built
npm run selfhost:inventory -- --json
npm run selfhost:inventory -- --compile-runs=1
npm run selfhost:inventory -- --compile-runs=2
npm run selfhost:inventory -- --output=.cache/selfhost/custom-inventory.json
npm run selfhost:inventory -- --timing-output=.cache/selfhost/custom-timings.json
```

`selfhost:inventory` builds the repository before running the inventory. `selfhost:inventory:built` reuses an existing build. The default outputs are:

- inventory: `.cache/selfhost/full-language-inventory.json`
- phase timings: `.cache/selfhost/full-language-inventory-timings.json`

The command has two successful states:

- `incomplete`: the project compiler boundary is healthy, but language-lowering diagnostics remain;
- `ready`: the canonical source set is accepted without diagnostics and emitted successfully.

Both states use exit code 0. Build failures, malformed compiler output, parser or checker coverage loss, unknown source references, non-canonical metadata, capability contradictions, output-path violations, and non-deterministic two-run results use a non-zero exit code.

## One validation engine

The inventory is split into three internal layers:

- `full-language-inventory.ts` validates and canonicalizes the machine-readable model;
- `full-language-inventory-runner.ts` builds the MVP compiler, materializes and loads a Stage 0 candidate, executes one or two compile runs, and converts the result into the inventory;
- `run-selfhost-full-language-inventory.mjs` provides the repository CLI and writes inventory and timing evidence.

The integration test and CLI call the same runner. One-run and two-run modes are inputs to the same implementation rather than separate validation paths.

## Execution modes

One compile validates source coverage, diagnostics, project-boundary blockers, capability state, readiness, and emitted-module counts. Two compiles perform the same validation and additionally require deterministic result equivalence.

- pull-request inventory gate: one compile by default;
- `main`, other non-pull-request CI events, Nightly, and the CLI default: two compiles;
- explicit `--compile-runs=1` or `--compile-runs=2`: repository CLI override.

The mode resolver fails closed for values other than exactly `1` or `2`.

## Determinism and isolation

The canonical inventory JSON excludes elapsed time, absolute paths, and temporary-directory names. For the same commit and source set, a successful two-run execution requires equivalent canonical results.

Each execution uses its own `.test-tmp/selfhost-inventory-*` directory and removes only that directory. Concurrent tests and commands therefore cannot delete each other's temporary state.

The inventory verifies:

- parsed and checked module counts equal the canonical source count;
- emitted-module statistics match the returned module list;
- diagnostics only reference canonical sources;
- dependency, exported-symbol, and capability-blocker metadata use canonical order;
- the obsolete `SHP2001` project-linking placeholder does not return;
- capability state agrees with `incomplete` or `ready` status.

## CI topology

The full-language inventory is not part of the ordinary Core test collection. CI reuses the canonical build artifact and runs the inventory in the dedicated `Self-host full-language inventory` job in parallel with the remaining quality lanes.

The repository-owned changed-path classifier publishes `selfhost_inventory_required`:

- `true`: execute the canonical inventory;
- `false`: record an explicit successful omission without running the expensive inventory;
- missing or invalid value: fail the gate before omission can be accepted.

The job itself remains visible and terminal for every non-documentation CI run. `release-artifacts` continues to require a successful inventory job, so path-based omission cannot leave a required check pending or bypass the release gate.

The CI integration test writes canonical inventory evidence to `.cache/ci-timings/selfhost-full-language-inventory.json`, and the dedicated job uploads the inventory evidence together with command timing and failure evidence.

## Retired readiness bridge

PR #279 used three diagnostic-only temporary files while permanent readiness changes were being prepared:

- `.github/scripts/tmp-apply-full-language-readiness.py`
- `.github/workflows/tmp-selfhost-full-language-readiness-pr.yml`
- `.github/workflows/tmp-selfhost-full-language-readiness.yml`

They are not part of the permanent stack. The repository temporary-artifact policy requires a clean tracked tree and contains a regression test for these exact paths. The dedicated CI job is the single canonical full-language inventory producer; the temporary bridge must not be restored.

Generated inventory and timing JSON files are evidence and are not committed to the repository.
