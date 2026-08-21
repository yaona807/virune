# Runtime ABI v2

日本語: [runtime-abi_ja.md](runtime-abi_ja.md)

Virune 1.0 emits ES2022 modules against Runtime ABI v2. This document defines the contract between generated code and the Runtime.

## Runtime representation

- primitive values use their validated JavaScript primitive representation;
- `record` values are null-prototype objects with enumerable fields and a non-enumerable nominal `$type` ID;
- `enum` values are aggregate values with stable tags;
- `newtype` preserves nominal identity at compile time but uses its validated underlying representation at runtime;
- `type` aliases have no runtime identity;
- `Option` and `Result` use Runtime constructors and tags;
- Virune `List`, `Map`, and `Set` values cannot be mutated from Virune code.

## `Eq` and `Hash`

Runtime ABI v2 has no user-replaceable `protocol registry`.

`Eq` and `Hash` are fixed structural operations over supported immutable values. Nominal aggregate IDs participate in comparison, so equally shaped values from different declarations are not treated as the same value.

Functions, `resource` values, foreign handles, and unsupported mutable values are not structurally comparable or hashable.

Compiler-derived `Eq` and `Hash` use these fixed operations. User code cannot replace their meaning.

## `Debug`

Compiler-derived `Debug` produces a stable developer representation only for supported values. It is generated only when requested and is not added automatically to TypeScript bindings.

## Cleanup

`defer` registers cleanup in the current function or `task` scope. Cleanup runs in LIFO order on normal return, early return, `?` propagation, panic, and asynchronous completion.

If both the primary operation and cleanup fail, both failures are retained according to the Runtime error aggregation contract.

## Structured concurrency

Every `task` belongs to a scope.

`parallel` and `parallel try` start child tasks in the current scope, cancel other tasks in the same scope when required, and wait for all started children to finish. When multiple failures are possible, failure selection remains deterministic and follows source order.

Normal Virune APIs do not create detached tasks outside a scope.

## Interop ABI v2 descriptors

Descriptors represent validated primitives, `Option`, `Result`, bytes, supported collections, `record`, `enum`, `type` aliases, and `newtype`.

A `record` field may carry:

- the external JavaScript property name;
- `missingAsNone`, which treats an omitted optional property as `None`;
- `omitWhenNone`, which omits the property when output is `None`;
- the `null` / `undefined` representation expected at the boundary;
- compile-time JSON defaults and strictness metadata.

`record` and `enum` descriptors carry the complete nominal `typeId` in `package#module:Type` form.

Recursive or unresolved types must not be guessed to be safe aggregates. If a type cannot be fully validated, it falls back to `Unknown` or requires an explicit Adapter.

A descriptor treated as safe does not claim safe conversion for callbacks, arbitrary JavaScript `Map` / `Set` values with object keys, or TypeScript `Record<K, V>`.

## JavaScript exports

Wrappers generated for `@jsExport` validate values received from JavaScript and convert values returned by Virune. They omit optional trailing arguments when required and defensively copy Virune aggregates exposed to JavaScript.

A foreign handle must never be treated as a validated native Virune value.

## Public ABI snapshot

`packages/public-abi.snapshot.json` records public declarations and the `exports` configuration for Runtime v2, Interop v2, and Stdlib public entry points. It also records every Runtime v2 symbol imported by generated JavaScript.

Verify compatibility with:

```bash
npm run abi:check
```

CI rejects public symbol removal, rename, incompatible signature changes, incompatible `exports` changes, and emitter references outside the Runtime v2 public surface.

Even compatible additions require review before updating the snapshot intentionally:

```bash
npm run abi:update
```

Updating the snapshot does not authorize an incompatible change. An intentional Runtime ABI break requires a new versioned ABI path and migration steps. Evaluate it under [`COMPATIBILITY.md`](../COMPATIBILITY.md).
