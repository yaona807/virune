# Full-language Self-host Inventory

The canonical full-language inventory is a repository-owned diagnostic command for the generated Stage 0 project compiler. It reports whether every Virune self-host source can be parsed and checked, groups the remaining diagnostics, and rejects project-compiler boundary regressions.

## Commands

```bash
npm run selfhost:inventory
npm run selfhost:inventory:built
npm run selfhost:inventory -- --json
npm run selfhost:inventory -- --output=.cache/selfhost/custom-inventory.json
```

`selfhost:inventory` builds the repository before running the inventory. `selfhost:inventory:built` reuses an existing build. The default JSON output is `.cache/selfhost/full-language-inventory.json`.

The command has two successful states:

- `incomplete`: the project compiler boundary is healthy, but language-lowering diagnostics remain;
- `ready`: the canonical source set is accepted without diagnostics and emitted successfully.

Both states use exit code 0. Build failures, malformed compiler output, non-deterministic repeated execution, parser or checker coverage loss, unknown source references, non-canonical metadata, capability contradictions, and output-path violations use a non-zero exit code.

## Single implementation

The inventory is split into three internal layers:

- `full-language-inventory.ts` validates and canonicalizes the machine-readable model;
- `full-language-inventory-runner.ts` builds the MVP compiler, materializes a Stage 0 candidate, runs the same request twice, and returns the inventory;
- `run-selfhost-full-language-inventory.mjs` provides the repository CLI.

The integration test calls the same runner as the CLI. It does not duplicate the inventory logic or invoke a test process from the command.

## Determinism and isolation

The JSON excludes timestamps, elapsed time, absolute paths, and temporary-directory names. For the same commit and source set, repeated output is byte-stable.

Each execution uses its own `.test-tmp/selfhost-inventory-*` directory and removes only that directory. Concurrent tests and commands therefore cannot delete each other's temporary state.

The inventory verifies:

- parsed and checked module counts equal the canonical source count;
- emitted-module statistics match the returned module list;
- diagnostics only reference canonical sources;
- dependency, exported-symbol, and capability blocker metadata use canonical order;
- the obsolete `SHP2001` project-linking placeholder does not return;
- capability state agrees with `incomplete` or `ready` status.

## CI evidence

The existing integration test writes deterministic evidence to `.cache/ci-timings/selfhost-full-language-inventory.json`. The existing core-test artifact upload already retains this directory, so no additional workflow or duplicate 900-second inventory job is introduced.

The generated JSON is diagnostic evidence and is not committed to the repository.
