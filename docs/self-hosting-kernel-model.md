# Self-hosting kernel data model

[日本語](self-hosting-kernel-model_ja.md)

The first Virune-authored compiler-kernel source lives in [`selfhost/kernel`](../selfhost/kernel). It is an isolated Stage 0 project and is not imported by the production TypeScript compiler path.

## Scope

The project defines data-only foundations for later lexer, parser, checker, and emitter stages:

- `SourcePosition` and `SourceSpan`;
- `TokenKind` and `Token`;
- `DiagnosticSeverity` and `Diagnostic`;
- explicit `NodeId`, `SymbolId`, and `TypeId` records;
- an immutable generic arena using explicit state passing;
- deterministic string and integer tables;
- a canonical JSON representation and host decode/encode boundary.

The implementation uses records, enums, immutable `List` values, local variables, and `Result`. It does not add classes, inheritance, reflection, unchecked casts, mutable record fields, compiler intrinsics, or self-host-only public standard-library APIs.

## Determinism

String and integer tables are constructed from complete value lists. Values are sorted and deduplicated before IDs are assigned, so equivalent inputs produce the same IDs and serialized order regardless of insertion order. IDs start at zero and increase by canonical value order.

`encodeCanonicalKernelModel` first decodes external data through the derived JSON decoder, rebuilds the deterministic tables, and then encodes the model. Malformed external data remains an explicit `Err(List<JsonError>)`; the Virune module does not panic.

## Host boundary

`packages/compiler/src/selfhost/kernel-model-host-adapter.ts` adapts the generated module's Result-based functions for TypeScript callers. The adapter is internal to the self-hosting path and is not exported from the stable compiler facade.

The compiler unit test builds the project with the current Stage 0 compiler, imports the emitted module, verifies canonical round trips, checks malformed input, and exercises arena allocation and missing-ID handling.

## Commands

Run the Virune-authored tests:

```bash
npm run build
node packages/cli/dist/src/main.js test selfhost/kernel
```

Build the project and run the baseline allocation, lookup, and serialization benchmark:

```bash
npm run build
node packages/cli/dist/src/main.js build selfhost/kernel
node scripts/benchmark-selfhost-kernel-model.mjs
```

The benchmark emits machine-readable JSON and intentionally has no fixed performance threshold at this stage. Later stages can establish regression budgets after representative lexer and parser workloads exist.

## Compatibility

This stage does not change the production compiler path, stable Compiler API, Runtime ABI, Interop ABI, grammar, language semantics, or public standard library. The generated project is a comparison and bootstrap input only.
