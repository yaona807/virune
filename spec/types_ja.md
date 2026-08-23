# 型

[英語版](types.md)

## `[type.static]` 静的型付け
Viruneは静的型付き言語です。すべての式はコンパイル時の型を持ち、数値、文字列、null許容値、Foreign値、集約値の暗黙変換は行いません。

## `[type.nominal-identity]` 名前的同一性
record、enum、`newtype`は、表記ではなくパッケージ、モジュール、宣言の同一性で識別します。別のモジュールにある同名の宣言は異なる型です。`import`のaliasと公開re-exportは元の同一性を維持します。

## `[type.alias]` 型aliasとnewtype
`type`は透過的な型aliasで、新しい型の同一性は作りません。`newtype`は名前的同一性を作り、JavaScript出力では基礎となる表現へ消去されます。直接構築できるのは宣言したモジュール内だけです。外部向けに検証付きコンストラクターを公開する場合は、通常の関数として定義します。

## `[type.tuple]` Tuple
Tuple型と値は、要素の順序と各要素の型を維持します。Tupleパターンは要素数（arity）が一致しなければなりません。

## `[type.nullability]` 値の不在
通常のVirune値は`null`または`undefined`になりません。1段の`Option<T>`は`T?`を正規表記とします。入れ子のOptionを明示する場合は`Option<T>`を使用できます。値は常に`Some`または`None`として明示します。

## `[type.result]` 回復可能な失敗
回復可能な失敗は`Result<T, E>`で表します。後置の`?`は、呼び出し元の戻り値型が受け取れる場合に限り、`Err`または`None`を伝播します。

## `[type.inference]` 型推論
ローカル値とジェネリック呼び出しの型は、単一化（unification）で推論します。公開APIの境界では型を明示します。数値、文字列、Option、Result、Foreign値、集約値の暗黙変換は行いません。

## `[type.generics]` ジェネリクス
ジェネリック宣言は不変です。型引数は、呼び出し引数と明示されたコールバックの期待型から推論します。Virune 1.0にはprotocol制約、higher-kinded type、ユーザー定義variance、オーバーロード、暗黙の実装探索はありません。

## `[type.composition]` 振る舞いの合成
再利用可能な振る舞いは、通常の関数と関数フィールドを持つrecordで表現します。実装は明示的に引数として渡します。Viruneには`protocol`、`impl`、`where`宣言はありません。依存性注入、コーデック、比較器、リポジトリ、テストダブルも、通常の値と同じモデルで構成できます。

## `[type.capabilities]` Effect
関数型は`uses`を使って、固定された組み込みeffectの集合を宣言できます。呼び出し元の関数は、必要な具体的effectをすべて宣言しなければなりません。利用者は新しいcapability名やeffect handlerを定義できません。

## `[type.open-effect-nonescaping]` Open callback effect
`uses *`を使用できるのは、外へescapeしないコールバック引数だけです。コールバックは直接呼び出すか、別の`uses *`コールバック引数へ転送できます。record、enum、tuple、list、map、型alias、newtype、クロージャ、戻り値、トップレベルの値、ローカル変数へ保存することはできません。これにより、effect-row型を公開せずにeffectの追跡を維持します。

## `[type.mutation]` 可変性
BindingとNative集約値はデフォルトで不変です。`let mut`で許可するのはローカル変数への再代入だけです。`record`のフィールド、`enum`のpayload、Nativeコレクション、newtype値をその場で変更することはできません。

## `[type.must-use]` Must-use値
`Future`、`Result`、resource、stream、`@mustUse`を付けた宣言の値は、何もせずに無視できません。値を束縛するか、`return`する、伝播する、`await`する、`match`する、または`discard expression`で明示的に破棄する必要があります。
