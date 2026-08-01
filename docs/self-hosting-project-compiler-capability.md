# Project compiler capability boundary

The generated Self-host compiler now exposes two versioned JSON functions:

- `projectCompilerCapability()`
- `compileProjectMvp(request)`

These functions fix the project-compilation transport before project-wide semantics are implemented.

## Capability v1

The capability object contains:

- `contractVersion`: `1`
- `requestSchema`: `virune.selfhost.project-compiler.request.v1`
- `resultSchema`: `virune.selfhost.project-compiler.result.v1`
- `ready`: whether the candidate may generate a complete project compiler artifact
- `blockers`: sorted machine-readable reasons when `ready` is false

The current candidate reports:

```json
{
  "contractVersion": "1",
  "ready": false,
  "requestSchema": "virune.selfhost.project-compiler.request.v1",
  "resultSchema": "virune.selfhost.project-compiler.result.v1",
  "blockers": ["project-semantics-not-implemented"]
}
```

Stage 1 readiness requires both exported functions and `ready: true`. A stub `compileProjectMvp` function cannot clear the gate.

## Compile request v1

The request carries contract version, language version, platform, canonical entry path, the complete source set, and emit options. The boundary currently validates:

- contract and language versions;
- node platform;
- non-empty and unique source paths;
- entry presence in the source set;
- ES2022 target;
- disabled source maps and enabled sources content.

A structurally valid request receives deterministic rejected evidence with diagnostic `SHP2000`. Invalid contract data receives stable `SHP1001`–`SHP1011` diagnostics. Malformed JSON fails through the Result error channel.

## What remains

The next implementation must add project-wide declaration collection, import resolution, visibility enforcement, type checking, and deterministic per-module emission behind this fixed transport. Only after those slices pass may the capability change to `ready: true` and actual Stage 1／Stage 2 generation begin.
