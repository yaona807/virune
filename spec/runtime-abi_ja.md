# Runtime ABI v2

[英語版](runtime-abi.md)

## `[runtime.version]` Runtime ABIバージョン
Virune 1.0.0が生成するJavaScriptはRuntime ABI v2を使用します。

## `[runtime.native-representation]` Virune側の実行時表現（Native表現）

- プリミティブ型は、検証済みのJavaScriptプリミティブ表現を使います。
- `record`は、列挙可能なフィールドと列挙不可の名前的`$type` IDを持つ、プロトタイプなしのオブジェクトです。
- `enum`は、安定したタグ付き集約値を使います。
- `newtype`はコンパイル時の名前的同一性を保ち、実行時には検証済みの基礎表現へ消去されます。
- 型エイリアスは実行時の同一性を持ちません。
- `Option`と`Result`はRuntimeのコンストラクターとタグを使います。
- Viruneの`List`、`Map`、`Set`はViruneコードから変更できません。

## `[runtime.eq-hash]` 構造的な等価性とハッシュ

等価性とハッシュは、対応している不変値に対する固定の構造演算です。比較には名前的な集約IDも含まれるため、形が同じでも別の宣言から作られた値を同じものとして扱うことはできません。関数、リソース、外部ハンドル（Foreignハンドル）、対応していない可変値は、構造比較やハッシュの対象外です。

コンパイラが生成する`Eq`と`Hash`は、この固定演算を使います。利用者のコードで意味を差し替えることはできません。

## `[runtime.debug]` Debug

コンパイラが生成するDebugは、対応している宣言で明示的に導出した場合だけ使用できます。

## `[runtime.interop-descriptors-v2]` Interop ABI v2の記述子

記述子は、検証済みのプリミティブ型、`Option`、`Result`、`Bytes`、対応しているコレクション、`record`、`enum`、型エイリアス、`newtype`を表現します。`record`のフィールドには以下の情報を持たせられます。

- 外部JavaScriptでのプロパティ名
- 省略可能なプロパティが存在しない場合に使う`missingAsNone`
- 出力時にプロパティを省略するための`omitWhenNone`
- 境界で期待する`null` / `undefined`表現
- コンパイル時のJSON既定値と厳格性メタデータ

`record`と`enum`の記述子は、完全な名前的`typeId`（`package#module:Type`）を持ちます。再帰または未解決の記述子を、暗黙に安全な集約値として扱うことはありません。`Unknown`へフォールバックするか、Adapterを要求します。

安全な記述子は、コールバックの検証、オブジェクトをキーにした任意のJavaScript `Map` / `Set`変換、TypeScriptの`Record<K, V>`変換を保証しません。
