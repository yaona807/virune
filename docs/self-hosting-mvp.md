# Self-hosting compiler MVP

[日本語](self-hosting-mvp_ja.md)

The first vertical Virune-authored compiler slice lives in [`selfhost/mvp`](../selfhost/mvp). It is an isolated Stage 0 project and is not selected by the production compiler path.

## Supported slice

The MVP implements the following pipeline in Virune:

1. deterministic tokenization with source positions and spans;
2. direct AST parsing for single-module functions;
3. function-symbol registration and local binding checks;
4. primitive type checking and explicit HIR lowering;
5. readable ES2022 module-body emission.

The supported language subset is intentionally small:

- `fn`, `let`, and `return`;
- `Bool`, `Int`, `Float`, `String`, and `Unit`;
- identifiers and function calls;
- unary `!` and `-`;
- arithmetic, comparison, equality, and logical binary operators;
- typed function parameters and return types.

Imports, records, enums, newtypes, generics, pattern matching, effects, async, parallel, defer, JavaScript interop, and production switching remain outside this milestone.

## Host boundary

The generated Virune module exposes one Result-based JSON function. The internal TypeScript adapter validates that result and maps it to Kernel Contract v1. The Host owns the exact runtime import line and final source-map encoding. MVP differential fixtures disable source maps so JavaScript and runtime behavior can be compared without ignoring any generated source-map field.

The adapter accepts exactly one Node-platform source module and rejects unsupported Interop Manifest entries or source-map requests. It is internal to the self-hosting path and is not exported from the stable Compiler API.

## Differential verification

The MVP corpus contains accepted arithmetic/call and primitive/logic fixtures plus a rejected unknown-name fixture. The differential runner compares:

- accepted or rejected status;
- diagnostic code, severity, message, and span;
- exported symbols;
- emitted JavaScript;
- runtime return value, output streams, exit code, and panic data.

No expected divergence is configured for the MVP fixtures.

## Commands

```bash
npm run selfhost:mvp:check
npm run selfhost:mvp:test
npm run selfhost:mvp:differential
```

The regular core suite also executes the Virune-authored MVP tests.

## Compatibility

This milestone does not change the production compiler selection, stable Compiler API, Runtime ABI, Interop ABI, normative grammar, language semantics, or public standard library. Sharing the base runtime-import constant is behavior-neutral and keeps production and self-host emission byte-identical for the supported slice.
