# Standard Types and Library Contracts

[English](standard-library.md) | [日本語](standard-library_ja.md)

## `[stdlib.bytes]` Byte and byte sequences
`Byte` is a checked newtype integer in `0..255`. `Bytes` is an immutable byte sequence represented by a copied `Uint8Array` at JavaScript boundaries. `MutableBytes` is an explicitly mutable buffer; converting to or from `Bytes` copies storage so immutable values cannot be mutated through aliases.

JSON encodes `Bytes` as a base64 string. File and HTTP APIs accept and return binary bodies through `Bytes` and `HttpBody.Bytes`.

## `[stdlib.fixed-integer]` Fixed-width integers
`Int8`, `UInt8`, `Int16`, `UInt16`, `Int32`, and `UInt32` use checked `Int` representations. `Int64` and `UInt64` use checked `BigInt` representations. Constructors return `Result<_, IntegerRangeError>` and never wrap or truncate.

## `[stdlib.unicode]` Unicode text
Existing String indexing, slicing, and `String.length` operate on Unicode code points. `String.graphemes` and `String.graphemeLength` operate on extended grapheme clusters. NFC, NFD, NFKC, and NFKD normalization are exposed as explicit operations and are never applied implicitly.

## `[collection.eq-hash]` Value-keyed collections
`Map` and `Set` are Virune value collections rather than JavaScript identity collections. Keys and elements are located using Virune `Eq` and `Hash`. Immutable update operations return new collections. JavaScript identity-keyed collections are not exposed as ordinary Virune Map or Set values.
