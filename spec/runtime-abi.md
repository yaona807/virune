# Runtime ABI v2

[日本語版](runtime-abi_ja.md)

## `[runtime.version]` Runtime ABI version
Virune 1.0.0 emits ES2022 modules against Runtime ABI v2.

## `[runtime.native-representation]` Native representation

- primitives use their validated JavaScript primitive representation;
- records are null-prototype objects with enumerable fields and a non-enumerable nominal `$type` ID;
- enums use stable tagged aggregate values;
- newtypes erase to their validated underlying representation while retaining compile-time nominal identity;
- type aliases have no runtime identity;
- Option and Result use Runtime constructors and tags;
- Virune `List`, `Map`, and `Set` values are immutable from Virune code.

## `[runtime.eq-hash]` Structural equality and hashing

Equality and hashing are fixed structural operations for supported immutable types. Nominal aggregate IDs participate in equality so equally shaped values from different declarations are not interchangeable. Functions, resources, foreign handles, and unsupported mutable values are not structurally comparable or hashable.

Compiler-derived `Eq` and `Hash` call these fixed operations. User code cannot replace them.

## `[runtime.debug]` Debug

Compiler-derived Debug produces a stable developer representation only for supported values and is explicit opt-in.

## `[runtime.interop-descriptors-v2]` Interop ABI v2 descriptors

Descriptors cover validated primitives, options, results, bytes, supported collections, records, enums, type aliases, and newtypes. Record fields may include:

- an external JavaScript property name;
- `missingAsNone` for optional property absence;
- `omitWhenNone` for output property omission;
- the null/undefined representation expected at the boundary;
- compile-time JSON defaults and strictness metadata.

Record and enum descriptors carry the complete nominal `typeId` (`package#module:Type`). Recursive or unresolved descriptors do not silently become safe aggregates; they fall back to `Unknown` or require an adapter.

Safe descriptors do not claim callback validation, arbitrary object-keyed JavaScript Map/Set conversion, or TypeScript `Record<K, V>` conversion.
