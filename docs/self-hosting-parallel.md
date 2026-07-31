# Self-host parallel validation

[日本語](self-hosting-parallel_ja.md)

This bounded Type Checker slice reproduces Legacy `parallel` and `parallel try` entry validation through a deterministic data-only contract.

## Rules

- Canonical entry IDs are contiguous and preserve request order.
- Duplicate entry names produce `L2036`.
- Non-Future entries produce `L2037`.
- `parallel try` entries whose Future value is not Result produce `L2038`.
- `parallel try` entries with different Result error types produce `L2039`.
- Duplicate fields preserve first insertion order while the later entry replaces the field type, matching the Legacy map behavior.
- Combined failures preserve Legacy per-entry order and short-circuiting.
- Unknown operand kinds, empty names or type handles, missing Future value types, and empty expressions produce bounded `L9001` diagnostics.

The JSON result preserves entries, canonical fields, the shared try error type, the computed result type, per-entry validation decisions, deterministic diagnostics, and an aggregate accepted flag.

```bash
npm run build
node --test --test-timeout=120000 packages/compiler/dist/test/selfhost-parallel.test.js
```

This slice consumes already resolved operand, value, and error type names. It does not infer types, inspect Future objects, lower tasks, implement scheduling, cancellation, or child-task lifecycle, connect to the Production Parser／Checker, or change the grammar, stable Compiler API, Runtime ABI, Interop ABI, or public standard library.
