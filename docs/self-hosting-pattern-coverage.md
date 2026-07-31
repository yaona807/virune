# Self-host closed pattern coverage

[日本語](self-hosting-pattern-coverage_ja.md)

The self-host checker models exhaustiveness as a deterministic pattern-space table before pattern binding and expression checking are connected.

## Supported spaces

The isolated JSON contract accepts a semantic source module and explicit match-arm descriptors. It resolves type aliases through the canonical semantic arena and supports:

- `Bool`: `true`, `false`;
- `Option<T>`: `Some`, `None`;
- `Result<T, E>`: `Ok`, `Err`;
- local enums, including generic instantiations;
- `Int` and `String` as open spaces that require an unguarded wildcard.

Case IDs are contiguous and follow the canonical language order. Local enum cases follow declaration-member order.

## Coverage rules

- An unguarded wildcard closes every supported pattern space.
- Guarded arms do not contribute to exhaustiveness.
- Duplicate unguarded patterns produce `L3002`.
- Arms after an unguarded wildcard are unreachable and produce `L3002`.
- Incomplete `Bool` coverage produces `L3003`.
- Missing enum, `Option`, or `Result` cases produce `L3004` in canonical order.
- `Int` and `String` without an unguarded wildcard produce `L3005`.
- Unknown targets or cases and malformed requests return diagnostics instead of panicking.

The result contains canonical cases, arm reachability, covered case IDs, missing case IDs and names, and the final exhaustiveness decision. Repeating the same request must produce identical JSON. Only the string-based JSON adapter is public; request, result, and semantic transport records remain module-private.

## Validation

```bash
npm run build
node --test --test-timeout=120000 packages/compiler/dist/test/selfhost-pattern-coverage.test.js
```

This slice does not type-check pattern payloads, create pattern bindings, compare arm result types, resolve multi-module enums, or connect to the Production Checker. It does not change the grammar, stable Compiler API, Runtime ABI, Interop ABI, or public standard library.
