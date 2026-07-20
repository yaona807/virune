# Incremental compilation

Virune provides a stateful incremental project compiler for editor and watch-mode integrations. One-shot CLI builds remain stateless and deterministic.

## Cache model

`IncrementalProjectBuilder` retains the following per module:

- stable file identity;
- source content hash;
- parsed AST and parser diagnostics;
- canonical public interface hash;
- dependency-interface fingerprint;
- semantic model;
- emitted JavaScript and source map.

A module is parsed again only when its source hash changes. Type checking and emission are repeated only when the module source, compiler configuration, or the public interface of a direct dependency changes.

An implementation-only edit therefore recompiles the changed module but reuses dependent modules. A public signature edit recompiles the changed module and direct dependents whose dependency fingerprint changed.

## API

The API is experimental because cache representation and invalidation strategy may evolve before stable 1.0.

```typescript
import { IncrementalProjectBuilder } from '@virune/compiler/experimental';

const builder = new IncrementalProjectBuilder();
const first = await builder.build(projectRoot, { write: false });
const next = await builder.build(projectRoot, { write: false });

console.log(next.stats.reusedParsedModules);
```

Use `invalidate(path)` to discard one module explicitly, or `clear()` to discard all compiled state.

## Language Server integration

The Virune Language Server owns one incremental builder for each project root. Unsaved buffers are supplied through its overlay project host. Source hashes decide whether parse, check, and emit results can be reused, so an editor snapshot invalidation does not force an unconditional project rebuild.

## Benchmark

Run:

```bash
npm run benchmark:incremental
```

The benchmark creates 100, 500, and 1,000-module projects and records clean, unchanged, implementation-change, and public-signature-change builds in `benchmarks/incremental/latest.json`. Results are environment-specific; the operation counts in `stats` are the correctness signal, while elapsed times are diagnostic data rather than a performance guarantee.
