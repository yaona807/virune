# JavaScript FFI

[日本語版](ffi_ja.md)

## `[ffi.explicit]` Explicit boundary
JavaScript and npm values enter through `extern js`. Normal imports cannot directly trust JavaScript values.

## `[ffi.optional-arguments]` Optional extern arguments
When trailing optional `extern js` arguments have JavaScript boundary representation `undefined`, the longest trailing suffix of those arguments is omitted from the invocation. An `undefined` value before a later argument is preserved so JavaScript argument positions do not change.

## `[ffi.safe]` Safe extern
A safe extern returns `Result<T, JsError>` or an async equivalent. Generated wrappers distinguish synchronous exceptions from Promise rejections, validate values, and convert them to Virune representations. Contract violations and explicit decode failures remain distinguishable from execution failures. Virune-only control or panic representation is not exposed raw through generated JavaScript callback boundaries. Composite safe decoding uses bounded traversal and structural safeguards; inputs that cannot be validated fail closed instead of becoming native Virune values.

## `[ffi.unknown-provenance]` Safe `Unknown` provenance
Runtime ABI v2's legacy `{ kind: 'unknown' }` descriptor remains a raw pass-through compatibility surface. Compiler-generated Safe boundaries use a separate versioned provenance-aware descriptor for Virune `Unknown`.

An identity-bearing JavaScript value decoded as Safe `Unknown` retains its original object identity and may cross a later Safe outbound `unknown` / `any` boundary only when that foreign origin was observed by the runtime. A Virune-native record, collection, callable, resource, capability, or other identity-bearing native value does not become a raw JavaScript value merely because it was erased to `Unknown`; Safe outbound encoding rejects it. Native primitive runtime representations such as `String`, `Bool`, `Float`, and `BigInt` remain directly representable and may cross a TypeScript `unknown` / `any` parameter when TypeScript proves that usage. Missing, stale, unsupported, or fabricated provenance metadata fails closed.

This provenance guarantee is a Safe-boundary property. It is not a hostile same-process tamper-resistance mechanism and does not redefine the legacy ABI v2 `unknown` descriptor.

## `[ffi.unsafe]` Unsafe extern
`unsafe extern` skips validation and is allowed only in an `unsafe module` under `ffi/`.

## `[ffi.export]` JavaScript export
`@jsExport` is valid only on public functions. Export wrappers validate JavaScript arguments and convert returned records, collections, Option, Result, and enums to documented JavaScript representations. They defensively copy native aggregate values exposed to JavaScript.

## `[ffi.bytes]` Binary values
Safe FFI accepts `Uint8Array` or `ArrayBuffer` for `Bytes` and copies the underlying data. Virune Bytes passed to JavaScript are copied. JSON represents Bytes as base64 text; invalid base64 is a decoding error. Record and enum conversion preserves Virune runtime type IDs, and Map/Set conversion restores Virune value-keyed collection semantics.
