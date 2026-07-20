# JavaScript FFI

[English](ffi.md) | [日本語](ffi_ja.md)

## `[ffi.explicit]` Explicit boundary
JavaScript and npm values enter through `extern js`. Normal imports cannot directly trust JavaScript values.

## `[ffi.safe]` Safe extern
A safe extern returns `Result<T, JsError>` or an async equivalent. Generated wrappers catch synchronous exceptions and Promise rejections, validate values, and convert them to Virune representations. Complex untrusted objects should enter as `Unknown` and be decoded.

## `[ffi.unsafe]` Unsafe extern
`unsafe extern` skips validation. It is allowed only in an `unsafe module` under `ffi/`. Unsafe declarations are explicit audit boundaries and may violate immutability or type assumptions.

## `[ffi.export]` JavaScript export
`@jsExport` is valid only on public functions. Export wrappers validate JavaScript arguments and convert returned records, collections, Option, Result, and enums to documented JavaScript representations.

## `[ffi.binding]` Declaration generation
`virune bind` conservatively maps TypeScript declaration files. `any` and unsupported constructs become `Unknown`; overloads require distinct generated names or manual review. Generated bindings are not automatically trusted.

## `[ffi.bytes]` Binary values
Safe FFI accepts `Uint8Array` or `ArrayBuffer` for `Bytes` and copies the underlying data. Virune Bytes passed to JavaScript are copied. JSON represents Bytes as base64 text; invalid base64 is a decoding error. Record and enum conversion preserves Virune runtime type IDs, and Map/Set conversion restores Virune value-keyed collection semantics.

## Three-tier interop
See [`js-interop.md`](js-interop.md). Foreign objects preserve identity and prototypes; explicit codecs are used only when values cross into native composite types.
