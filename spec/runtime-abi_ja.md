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

等価性の判定とハッシュ計算は、対応する不変値に対して、あらかじめ決められた構造上の演算を使います。比較には型の同一性も含めるため、同じ形の値でも、別の宣言から作られたものは同じ値として扱いません。関数、リソース、外部ハンドル（Foreignハンドル）、未対応の可変値は、構造比較やハッシュ計算の対象外です。

コンパイラが生成する`Eq`と`Hash`は、この固定演算を使います。利用者のコードで意味を差し替えることはできません。

## `[runtime.debug]` Debug

コンパイラーが生成するDebugは、対応する値を開発者向けの安定した`String`表現へ変換します。利用できるのは、対応する宣言で明示的にDebugを導出した場合だけです。

## `[runtime.interop-descriptors-v2]` Interop ABI v2の記述子

記述子は、検証済みのプリミティブ型、`Option`、`Result`、`Bytes`、対応しているコレクション、`record`、`enum`、型エイリアス、`newtype`を表現します。`record`のフィールドには以下の情報を持たせられます。

- 外部JavaScriptでのプロパティ名
- 省略可能なプロパティが存在しない場合に使う`missingAsNone`
- 出力時にプロパティを省略するための`omitWhenNone`
- 境界で期待する`null` / `undefined`表現
- コンパイル時のJSON既定値と厳格性メタデータ

`record`と`enum`の記述子には、完全な型ID（`package#module:Type`）を記録します。再帰的な構造、未解決の構造、未対応の構造を、安全な集約値として勝手に扱ってはいけません。`Unknown`へフォールバックするか、Adapterの利用を要求します。