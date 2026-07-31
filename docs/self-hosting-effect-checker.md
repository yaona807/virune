# Self-host effect requirement checker

[日本語](self-hosting-effect-checker_ja.md)

The effect-checking slice validates bounded function `uses` declarations and effect requirements through a deterministic JSON contract. It preserves the Virune v1 Legacy checker contract without traversing expressions or inferring a call graph.

## Built-in effects

The canonical effect order is:

`Console`, `Task`, `File`, `Process`, `Network`, `Timer`, `Clock`, `Storage`, `Dom`, `Random`, `JavaScript`.

Input order and duplicate entries do not affect the serialized result. `uses *` sets the function wildcard and satisfies every known effect requirement.

Unknown declared or required effects produce `L2085`. A known requirement missing from the enclosing function produces `L2076`. Duplicate function entries produce `L1001`; empty names and unknown function IDs produce `L9001`.

The result contains contiguous function and requirement IDs, canonical declared and required effects, missing effects, satisfaction decisions, and deterministic diagnostics.

```bash
npm run build
node --test --test-timeout=120000 packages/compiler/dist/test/selfhost-effect-checker.test.js
```

This slice does not traverse expressions, infer calls, register custom effects, validate platform availability, or implement async／await, defer, or structured-concurrency semantics. It does not connect the self-host checker to the Production Compiler or change the grammar, stable Compiler API, Runtime ABI, Interop ABI, or public standard library.
