# 標準型と標準ライブラリの契約

[英語版](standard-library.md)

## `[stdlib.bytes]` Byteとバイト列
`Byte`は`0..255`の範囲を検査するnewtype整数です。`Bytes`は不変のバイト列で、JavaScriptとの境界ではコピーした`Uint8Array`として表現します。`MutableBytes`は明示的に可変なbufferです。`Bytes`との相互変換ではストレージをコピーし、不変値がalias経由で変更されることを防ぎます。

JSONでは`Bytes`をbase64文字列としてencodeします。File / HTTP APIでは、`Bytes`と`HttpBody.Bytes`を使ってバイナリbodyを受け渡します。

## `[stdlib.fixed-integer]` 固定幅整数
`Int8`、`UInt8`、`Int16`、`UInt16`、`Int32`、`UInt32`は、範囲を検査する`Int`表現を使います。`Int64`と`UInt64`は、範囲を検査する`BigInt`表現を使います。constructorは`Result<_, IntegerRangeError>`を返し、wrapやtruncateは行いません。

## `[stdlib.unicode]` Unicodeテキスト
既存のString index、slice、`String.length`はUnicodeコードポイント単位です。`String.graphemes`と`String.graphemeLength`はextended grapheme cluster単位です。NFC、NFD、NFKC、NFKDの正規化は明示的なAPIとして提供し、暗黙には適用しません。

## `[collection.eq-hash]` 値で比較するコレクション
`Map`と`Set`はJavaScriptのidentity collectionではなく、Viruneの値コレクションです。キーや要素の検索にはViruneの`Eq`と`Hash`を使います。不変更新では新しいコレクションを返します。JavaScriptのidentityを使うコレクションを、通常のVirune `Map` / `Set`として公開することはありません。
