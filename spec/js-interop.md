# JavaScript Interoperability Model

[English](js-interop.md) | [日本語](js-interop_ja.md)

This document defines the normative architecture of JavaScript interoperability. Low-level `extern js` rules remain in [`ffi.md`](ffi.md).

## Three tiers

1. **Direct facade.** `import js` exposes a conservative subset of a declared JavaScript API. Dependency source is executed unchanged.
2. **Compiled adapter.** Complex TypeScript APIs are isolated in `*.interop.ts`, type-checked with the pinned TypeScript provider, and emitted as ESM before Virune execution.
3. **Unsafe boundary.** `unsafe extern js` is reserved for APIs without usable declarations or with inherently dynamic behavior.

## Direct facade

The direct facade supports default, named, namespace, side-effect, and named type-only imports; property access; function and method calls; forwarding foreign handles; and `await` on declared Promise-like results.

The provider resolves calls only from the callee and actual argument types. A Virune expected return type MUST NOT participate in JavaScript overload or generic selection. Return-only generic parameters MAY resolve from a TypeScript default or base constraint. Calls requiring callback typing, constructor syntax, structural object literals, bidirectional inference, ambiguous overloads, or complex conditional/mapped types MUST use an adapter.

Named imports from a CommonJS runtime are rejected because synthetic named exports are not portable. Use a default or namespace import, or an adapter.

A TypeScript `any` import is rejected by the direct facade. TypeScript `unknown` remains an unknown foreign value and can cross to Virune `Unknown` without asserting a narrower type.

## Foreign values

Foreign values preserve JavaScript identity, prototype, method receiver, Promise behavior, and module binding semantics. They may be forwarded to another foreign call. Virune arithmetic, comparison, pattern matching, collection semantics, and native methods require a prior bridge to a native Virune type.

Foreign values MUST NOT appear in public Virune signatures. External handles are exposed through a Virune `newtype` type.

## Bridges

Implicit bridges are limited to one-to-one runtime representations:

- JavaScript `boolean` to `Bool`
- JavaScript `string` to `String`
- JavaScript `bigint` to `BigInt`
- JavaScript `number` to `Float`
- TypeScript `void` to `Unit` by discarding the returned value
- TypeScript `unknown` to Virune `Unknown`

JavaScript `number` to `Int`, arrays to `List`, objects to records, Map/Set conversion, byte conversion, nullable conversion, and native composite values passed to JavaScript require explicit codecs.

A failed implicit primitive check raises `ForeignContractError`. It is not converted to an ordinary JavaScript exception result. Recoverable external data validation uses an explicit decoder.

## Interop ABI v1

An adapter export MUST be a single non-generic call signature. Callback parameters, overloads, arrays, tuples, anonymous structural objects, adapter-local object types, intersections, `any`, and nested Promise-like values are not ABI v1 values. Structural data is exported as `unknown` and decoded in Virune. Named external classes and objects may be exported as foreign handles.

Adapter output consists of `.interop.mjs`, a source map, and `.virune-abi.json`. ABI metadata is deterministic and includes the schema version, ABI version, pinned TypeScript provider version, source hash, ABI hash, normalized exports, and source path.

Adapters MUST NOT import generated Virune output. This preserves an acyclic build order: JavaScript package → TypeScript adapter → Virune module.

## Resolution and stable IR

Type declaration resolution and runtime module resolution are recorded separately. The witness includes runtime and declaration package identities, entries, module format, conditions, provider version, and hashes. Browser/bundler runtime resolution remains the bundler's responsibility.

TypeScript compiler objects are valid only during provider analysis. After type checking, Virune stores serializable provider-independent usage records. Code generation MUST NOT depend on `ts.Type`, `ts.Symbol`, or a live TypeScript `Program`.

## Trust boundary

- Native Virune code is checked by the Virune compiler.
- Foreign static shapes come from TypeScript declarations.
- Primitive bridges perform runtime checks.
- Composite codecs validate and copy data with explicit budgets and structural safeguards.
- JavaScript implementation behavior and declaration accuracy remain dependency trust boundaries.
