# Self-hosted FFI boundary validation

[English](self-hosting-ffi.md) | [日本語](self-hosting-ffi_ja.md)

This Stage 0 slice validates the JavaScript FFI rules through an isolated, deterministic JSON contract. It does not execute JavaScript or connect the self-hosted checker to the Production compiler path.

## Boundary

The Host provides:

- a flat canonical FFI type arena with contiguous IDs;
- `extern js` declarations with already-resolved parameter and return type IDs;
- module policy inputs such as platform, source-relative path, and unsafe mode;
- `@jsExport` declarations with already-resolved boundary type IDs.

No TypeScript AST, JavaScript object, module resolver, or runtime value crosses the contract.

## Canonical type safety

The validator mirrors the Production checker’s conservative FFI classification:

- primitive values are safe except `Never` and `InvalidType`;
- functions, foreign values, and type variables are unsafe;
- lists, tuples, `Option`, `Future`, and `Result` are checked recursively;
- `Map` keys and `Set` elements must be primitive keys;
- open generic or unknown-shape named types are unsafe;
- recursive cycles terminate deterministically and are unsafe.

Malformed arena IDs, kinds, shapes, and references produce bounded `L9001` diagnostics.

## Extern validation

Safe extern functions must use recursively safe parameters and return `Result<T, E>` or `Future<Result<T, E>>`. Optional parameters must be trailing.

The contract preserves these existing diagnostics:

- `L2115`: optional extern parameter ordering;
- `L4001`: safe extern does not return Result;
- `L4006`: `node:` module on a non-Node platform;
- `L4007`: unsafe extern outside an unsafe module;
- `L4008`: unsafe extern outside `ffi/`;
- `L4009`: unsafe module outside `ffi/`;
- `L4213`: a safe boundary type cannot be fully validated.

## JavaScript exports

`@jsExport` is checked for function-only use, public visibility, concrete non-generic signatures, no attribute arguments, and recursively safe parameter and return types. The validator preserves `L2052`–`L2055` and `L4213`.

## Determinism and scope

The result uses contiguous type, extern-function, and export IDs. Diagnostic ordering follows the Production checker’s module-policy, parameter, return, and export-validation order. Identical requests produce byte-identical JSON.

This slice does not change the grammar, stable Compiler API, Runtime ABI, Interop ABI, public standard library, JavaScript wrapper generation, or Production compiler selection.
