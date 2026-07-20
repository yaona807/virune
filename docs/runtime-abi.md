# Runtime ABI v2

[日本語](runtime-abi_ja.md)

Virune 1.0.0 emits ES2022 modules against Runtime ABI v2.

## Native representation

- primitives use their validated JavaScript primitive representation;
- records are null-prototype objects with enumerable fields and a non-enumerable nominal `$type` ID;
- enums use stable tagged aggregate values;
- newtypes erase to their validated underlying representation while retaining compile-time nominal identity;
- type aliases have no runtime identity;
- Option and Result use Runtime constructors and tags;
- native List, Map, and Set values are immutable from Virune code.

## Structural equality and hashing

Runtime ABI v2 has no protocol registry. Equality and hashing are fixed structural operations for supported immutable types. Nominal aggregate IDs participate in equality so equally shaped values from different declarations are not interchangeable. Functions, resources, foreign handles, and unsupported mutable values are not structurally comparable or hashable.

Compiler-derived `Eq` and `Hash` call these fixed operations. User code cannot replace them.

## Debug

Compiler-derived Debug produces a stable developer representation only for supported values. It is explicit opt-in and is not generated automatically for TypeScript bindings.

## Cleanup

`defer` registers cleanup in the current function/task scope. Cleanup executes in LIFO order on normal return, early return, `?` propagation, panic, and asynchronous completion. Primary and cleanup failures are retained according to the Runtime error aggregation contract.

## Structured concurrency

Every task belongs to a scope. `parallel` and `parallel try` start children in the current scope, cancel siblings when required, wait for all children to settle, and preserve deterministic source-order failure selection. The Runtime does not expose detached tasks through normal Virune APIs.

## Interop ABI v2 descriptors

Descriptors cover validated primitives, options, results, bytes, supported collections, records, enums, type aliases, and newtypes. Record fields may include:

- an external JavaScript property name;
- `missingAsNone` for optional property absence;
- `omitWhenNone` for output property omission;
- the null/undefined representation expected at the boundary;
- compile-time JSON defaults and strictness metadata.

Record and enum descriptors carry the complete nominal `typeId` (`package#module:Type`). Recursive or unresolved descriptors do not silently become safe aggregates; they fall back to `Unknown` or require an adapter.

Safe descriptors do not claim callback validation, arbitrary object-keyed JavaScript Map/Set conversion, or TypeScript `Record<K, V>` conversion.

## JavaScript exports

`@jsExport` wrappers validate inbound values, convert outbound values, omit optional trailing arguments when required, and defensively copy native aggregate values exposed to JavaScript. Foreign handles remain foreign and are never presented as validated native values.
