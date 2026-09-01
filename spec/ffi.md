# JavaScript FFI

[日本語版](ffi_ja.md)

## `[ffi.explicit]` Explicit boundary
JavaScript and npm values enter through `extern js`. Normal imports cannot directly trust JavaScript values.

## `[ffi.optional-arguments]` Optional extern arguments
When trailing optional `extern js` arguments have JavaScript boundary representation `undefined`, the longest trailing suffix of those arguments is omitted from the invocation. An `undefined` value before a later argument is preserved so JavaScript argument positions do not change.

## `[ffi.safe]` Safe extern
A safe extern returns `Result<T, JsError>` or an async equivalent. Generated wrappers distinguish synchronous exceptions from Promise rejections, validate values, and convert them to Virune representations. Contract violations and explicit decode failures remain distinguishable from execution failures. Virune-only control or panic representation is not exposed raw through generated JavaScript callback boundaries. Composite safe decoding uses bounded traversal and structural safeguards; inputs that cannot be validated fail closed instead of becoming native Virune values.

## `[ffi.unknown-provenance]` Safe `Unknown` provenance
Runtime ABI v2's legacy `{ kind: 'unknown' }` type descriptor remains a raw pass-through compatibility surface. Compiler-generated Safe boundaries use a separate versioned `virune-safe-ffi/v1` boundary envelope around the unchanged Runtime v2 type descriptor. Within that Safe boundary only, every nested `unknown` is provenance-aware.

An identity-bearing JavaScript value decoded as Safe `Unknown` retains its original object identity and may cross a later Safe outbound `unknown` / `any` boundary only when that foreign origin was observed by the runtime. A Virune-native record, collection, callable, resource, capability, or other identity-bearing native value does not become a raw JavaScript value merely because it was erased to `Unknown`; Safe outbound encoding rejects it. Native primitive runtime representations such as `String`, `Bool`, `Float`, and `BigInt` remain directly representable and may cross a TypeScript `unknown` / `any` parameter when TypeScript proves that usage. Missing, stale, unsupported, partial, malformed, or otherwise non-canonical Safe-boundary envelopes fail closed.

The Safe-boundary envelope is compiler-private metadata, not an authentication token. The provenance guarantee comes from runtime-observed foreign identity, and is not a hostile same-process tamper-resistance mechanism. It does not redefine the legacy ABI v2 `unknown` descriptor or JSON encoding semantics.

## `[interop.ecmascript-canonical-identity]` Canonical ECMAScript identity
When current Direct Interop semantics need to recognize a standard JavaScript concept, the compiler records a deterministic compiler-owned identity only after the TypeScript provider proves the corresponding semantic identity inside its fixed Program snapshot. The shipped identity in this version is `ecmascript:Promise`, used for the actual global ECMAScript `Promise` type. References to that same type keep the same identity when reached through lib.es-backed declarations, Web/DOM declarations, Node declarations, or npm declaration graphs.

Canonical identity is not inferred from a package name, declaration filename or absolute path, TypeScript object ID, or display-only `typeToString()` text. A structural thenable or another unsupported/unknown type is not promoted to `ecmascript:Promise`. Provider-local proof is consumed into stable compiler evidence as the constant canonical identity; stale provider references remain invalid.

## `[ffi.unsafe]` Unsafe extern
`unsafe extern` skips validation and is allowed only in an `unsafe module` under `ffi/`.

## `[ffi.export]` JavaScript export
`@jsExport` is valid only on public functions. Export wrappers validate JavaScript arguments and convert returned records, collections, Option, Result, and enums to documented JavaScript representations. They defensively copy native aggregate values exposed to JavaScript.

## `[ffi.bytes]` Binary values
Safe FFI accepts `Uint8Array` or `ArrayBuffer` for `Bytes` and copies the underlying data. Virune Bytes passed to JavaScript are copied. JSON represents Bytes as base64 text; invalid base64 is a decoding error. Record and enum conversion preserves Virune runtime type IDs, and Map/Set conversion restores Virune value-keyed collection semantics.
