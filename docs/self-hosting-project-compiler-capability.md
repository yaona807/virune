# Project compiler capability boundary

The generated Self-host compiler exposes two versioned JSON functions:

- `projectCompilerCapability()`
- `compileProjectMvp(request)`

These functions fix the project-compilation transport and now perform deterministic parsing of the complete canonical Virune source set. Project linking, semantic checking, and emission remain fail-closed.

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
  "blockers": ["project-linking-not-implemented"]
}
```

Stage 1 readiness requires both exported functions and `ready: true`. Parsing every source does not clear the gate while linking, checking, and emission remain unavailable.

## Compile request v1

The request carries contract version, language version, platform, canonical entry path, the complete source set, and emit options. The boundary validates:

- contract and language versions;
- node platform;
- non-empty and unique source paths;
- canonical source ordering by path;
- entry presence in the source set;
- ES2022 target;
- disabled source maps and enabled sources content.

An unsorted source set fails with `SHP1012` before parsing. Other contract failures use stable `SHP1001`–`SHP1011` diagnostics. Malformed JSON fails through the Result error channel.

## Project source parsing

For a structurally valid request, the generated compiler calls its existing Virune-authored recursive-descent frontend parser exactly once for every source in canonical order. Parser diagnostics are aggregated without crossing the filesystem boundary and retain:

- diagnostic code, severity, and message;
- canonical `sourcePath`;
- start and end offset／line／column span;
- reserved notes transport.

All sources are parsed even when one source is malformed, so the result remains deterministic and `stats.parsedModules` covers the complete request source set. A parser failure prevents linking and emission. When all sources parse successfully, the result returns `SHP2001` to state that project-wide linking, checking, and emission are not implemented.

## Compile result v1

The result transport can carry a future Stage 1 compiler artifact without another top-level schema change. It contains:

- echoed language version, platform, and canonical entry path;
- accepted／rejected state and path-aware deterministic diagnostics;
- canonical emitted modules with source path, output path, JavaScript, and source map text;
- canonical dependency metadata;
- canonical exported-symbol metadata;
- parsed, checked, emitted, reused, and invalidated module statistics.

The current non-ready implementation returns empty artifact／metadata arrays. It reports parsed modules but keeps checked, emitted, reused, and invalidated counts at zero. The Host verifies exact keys, normalized paths, diagnostic source ownership, spans, canonical ordering, uniqueness, full source coverage, and emitted-module statistics. Rejected results cannot contain emitted modules.

## What remains

The next implementation must collect module declarations and imports, construct and validate the project graph, enforce visibility and public API rules, type-check the linked project, and emit deterministic modules behind this fixed transport. Only after those slices pass may the capability change to `ready: true` and actual Stage 1／Stage 2 generation begin.
