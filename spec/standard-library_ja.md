# 標準型・標準ライブラリ契約

[English](standard-library.md) | [日本語](standard-library_ja.md)

## `[stdlib.bytes]` Byteとbyte列
`Byte`は`0..255`を検査するnewtype integerです。`Bytes`は不変byte列で、JavaScript境界ではcopyした`Uint8Array`として表現します。`MutableBytes`は明示的に可変なbufferです。`Bytes`との相互変換ではstorageをcopyし、不変値がalias経由で変更されることを防ぎます。

JSONは`Bytes`をbase64文字列としてencodeします。File／HTTP APIは`Bytes`と`HttpBody.Bytes`でbinary bodyを扱います。

## `[stdlib.fixed-integer]` 固定幅整数
`Int8`、`UInt8`、`Int16`、`UInt16`、`Int32`、`UInt32`は検査付き`Int`表現です。`Int64`と`UInt64`は検査付き`BigInt`表現です。constructorは`Result<_, IntegerRangeError>`を返し、wrapやtruncateを行いません。

## `[stdlib.unicode]` Unicode text
既存のString index、slice、`String.length`はUnicode code point単位です。`String.graphemes`と`String.graphemeLength`はextended grapheme cluster単位です。NFC、NFD、NFKC、NFKD正規化は明示的APIとして提供し、暗黙には適用しません。

## `[collection.eq-hash]` 値比較collection
`Map`と`Set`はJavaScript identity collectionではなく、Viruneの値collectionです。key／elementの検索にはVirune `Eq`と`Hash`を使います。不変更新操作は新しいcollectionを返します。JavaScript identityを使うcollectionは通常のVirune Map／Setとして公開しません。
