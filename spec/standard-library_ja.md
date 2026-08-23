# 標準型と標準ライブラリの契約

[英語版](standard-library.md)

## `[stdlib.bytes]` `Byte`とバイト列
`Byte`は`0..255`の範囲を検査する`newtype`整数です。`Bytes`は不変のバイト列で、JavaScriptとの境界ではコピーした`Uint8Array`として表現します。`MutableBytes`は明示的に可変なバッファです。`Bytes`との相互変換ではストレージをコピーし、不変値がエイリアス経由で変更されることを防ぎます。

JSONでは`Bytes`をbase64文字列としてエンコードします。ファイルAPIとHTTP APIでは、`Bytes`と`HttpBody.Bytes`を使ってバイナリボディを受け渡します。

## `[stdlib.fixed-integer]` 固定幅整数
`Int8`、`UInt8`、`Int16`、`UInt16`、`Int32`、`UInt32`は、範囲を検査する`Int`表現を使います。`Int64`と`UInt64`は、範囲を検査する`BigInt`表現を使います。コンストラクターは`Result<_, IntegerRangeError>`を返し、値をラップしたり切り捨てたりしません。

## `[stdlib.unicode]` Unicodeテキスト
既存のStringのインデックス参照、スライス、`String.length`はUnicodeコードポイント単位です。`String.graphemes`と`String.graphemeLength`は拡張書記素クラスタ単位です。NFC、NFD、NFKC、NFKDの正規化は明示的な操作として提供し、暗黙には適用しません。

## `[collection.eq-hash]` 値の等価性で比較するコレクション
`Map`と`Set`は、JavaScriptのオブジェクト同一性ではなく、Viruneの値としてキーや要素を比較します。キーや要素の検索にはViruneの`Eq`と`Hash`を使います。不変更新では新しいコレクションを返します。JavaScriptのオブジェクト同一性を基準にしたコレクションを、通常のVirune `Map` / `Set`として公開することはありません。
