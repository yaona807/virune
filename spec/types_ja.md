# 型

## `[type.static]` 静的型付け
Viruneは静的型付き言語です。すべての式はコンパイル時の型を持ち、数値・文字列・nullability・Foreign値・集約値の暗黙変換を認めません。

## `[type.nominal-identity]` 名前的同一性
record、enum、`newtype`は表記ではなくpackage・module・declarationの同一性で識別します。別moduleの同名宣言は異なる型です。import aliasとpublic re-exportは元の同一性を維持します。

## `[type.alias]` Type aliasとnewtype
`type`は透過的aliasで、新しい型同一性を作りません。`newtype`は名前的同一性を作り、JavaScript出力では基礎表現へeraseします。直接構築は宣言module内だけで可能で、外部向けの検証付きconstructorは通常の関数として定義します。

## `[type.tuple]` Tuple
Tuple型と値は要素順と各要素型を維持します。Tuple patternはarityが一致しなければなりません。

## `[type.nullability]` 値の不在
通常のVirune値は`null`または`undefined`になりません。1段の`Option<T>`は`T?`をcanonical表記とします。Nested Optionを明示する場合は`Option<T>`を使用できます。値は常に`Some`または`None`で明示します。

## `[type.result]` 回復可能な失敗
回復可能な失敗は`Result<T, E>`で表します。postfix `?`は、呼び出し元の戻り値型が受け取れる場合に限り`Err`または`None`を伝播します。

## `[type.inference]` 型推論
local値とgeneric呼び出しの型はunificationで推論します。Public API境界は明示します。数値・文字列・Option・Result・Foreign値・集約値の暗黙変換はありません。

## `[type.generics]` Generics
generic宣言は不変です。型引数はcall引数と明示されたcallback期待型から推論します。Virune 1.0にはprotocol制約、higher-kinded type、ユーザー定義variance、overload、暗黙implementation探索はありません。

## `[type.composition]` 振る舞いの合成
再利用可能な振る舞いは通常の関数と、関数fieldを持つrecordで表現します。実装は明示的に引数で渡し、`protocol`、`impl`、`where`宣言は持ちません。Dependency injection、codec、comparator、repository、test doubleを通常の値モデルだけで構成できます。

## `[type.capabilities]` Effect
関数型は`uses`で固定の組み込みeffect集合を宣言できます。呼び出し元関数は必要な具体effectをすべて宣言します。利用者は新しいcapability名やeffect handlerを定義できません。

## `[type.open-effect-nonescaping]` Open callback effect
`uses *`は非escapeのcallback parameterだけに使用できます。callbackは直接呼び出すか、別の`uses *` callback parameterへ転送できます。record、enum、tuple、list、map、type alias、newtype、closure、戻り値、top-level値、local変数へ保存できません。これによりeffect-row型を公開せずeffect追跡を維持します。

## `[type.mutation]` 可変性
BindingとNative集約値はデフォルトで不変です。`let mut`はlocal再代入だけを許可します。record field、enum payload、Native collection、newtype値をin-place変更できません。

## `[type.must-use]` Must-use値
`Future`、`Result`、resource、stream、`@mustUse`宣言の値は黙って無視できません。bind、return、propagate、await、match、または`discard expression`による明示破棄が必要です。
