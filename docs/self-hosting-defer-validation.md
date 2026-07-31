# Self-host defer validation

[日本語](self-hosting-defer-validation_ja.md)

This bounded Type／Effect Checker slice reproduces Legacy `defer` context and expression-result validation through a deterministic data-only contract.

## Rules

- Canonical scope and defer-statement arenas use contiguous IDs.
- Function and test scopes accept `defer`.
- Module scope produces `L2070`.
- Deferred expressions inferred as `Unit` or `Never` are valid.
- Every other non-empty inferred type produces `L2071`.
- When both context and result type are invalid, `L2070` is emitted before `L2071`, matching Legacy validation order.
- Duplicate scope names produce `L1001`.
- Unknown scope kinds, empty names or type handles, and invalid scope references produce bounded `L9001` diagnostics.

The result preserves the canonical scope and statement arenas, per-statement context／type decisions, deterministic diagnostics, and an aggregate accepted flag.

```bash
npm run build
node --test --test-timeout=120000 packages/compiler/dist/test/selfhost-defer-checker.test.js
```

This slice consumes already inferred expression type names. It does not infer expression types, lower cleanup order, aggregate effects, implement async／await or structured concurrency, connect to the Production Parser／Checker, or change the grammar, stable Compiler API, Runtime ABI, Interop ABI, or public standard library.
