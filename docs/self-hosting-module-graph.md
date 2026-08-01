# Self-host canonical module graph

The self-host kernel now has a deterministic, data-only module graph boundary for the project-semantics phase.

## Contract

`buildCanonicalModuleGraph` accepts a versioned entry path, project modules, and normalized import records. It:

- normalizes project-relative paths;
- assigns contiguous module and edge IDs in canonical order;
- resolves Virune edges without filesystem or TypeScript objects;
- reports missing entries, missing targets, duplicate imports, self imports, and import cycles;
- records entry reachability and unreachable modules;
- returns byte-stable JSON-compatible data for identical semantic input.

Malformed boundary data throws `ModuleGraphContractError`. Semantic graph failures remain in the returned `issues` list and set `accepted` to `false`.

## Boundary

This slice does not load files, resolve package exports, execute JavaScript, change the production compiler, or define final Legacy diagnostic codes. The Host remains responsible for collecting sources and supplying resolved import paths. Interop resolution evidence is validated separately.
