# Self-host async／await validation

[日本語](self-hosting-async-await_ja.md)

This bounded Type／Effect Checker slice reproduces Legacy async-context, await-operand, and JavaScript-effect validation through a deterministic data-only contract.

## Rules

- Canonical context and await-expression arenas use contiguous IDs.
- Async function and async test contexts accept `await`; other contexts produce `L2022`.
- `Future<T>` produces awaited type `T` supplied by the validated Host contract.
- A foreign JavaScript value is awaitable only when the Host supplies a non-empty PromiseLike awaited type.
- Non-Future／non-PromiseLike operands produce `L2023`.
- Foreign await requires `uses JavaScript` or `uses *`; a missing declaration produces `L2076`.
- Combined failures preserve Legacy order: `L2022`, then `L2076`, then `L2023`.
- Duplicate context names produce `L1001`.
- Unknown context／operand kinds, empty type handles, missing Future value types, and invalid references produce bounded `L9001` diagnostics.

The JSON result preserves canonical contexts and expressions, result types, context／operand decisions, required／missing effects, deterministic diagnostics, and an aggregate accepted flag.

```bash
npm run build
node --test --test-timeout=120000 packages/compiler/dist/test/selfhost-async-await.test.js
```

This slice consumes already resolved operand and awaited type names. It does not inspect JavaScript PromiseLike objects, infer types, lower async state machines, implement scheduling or cancellation, connect to the Production Parser／Checker, or change the grammar, stable Compiler API, Runtime ABI, Interop ABI, or public standard library.
