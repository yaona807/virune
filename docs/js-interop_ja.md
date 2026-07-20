# JavaScript／TypeScript連携

[English](js-interop.md)

## 境界モデル

Viruneは3段階で扱います。

1. Runtimeで完全検証できるTypeScript宣言から生成するdirect binding
2. 意図的なshape変換を行うcompiled TypeScript Adapter
3. 手動監査する隔離済み`unsafe extern`

通常のViruneコードはsafe facadeをimportし、生のJavaScript表現を意識しません。

## Import形式

```virune
import js { nanoid } from "nanoid"
import js axios from "axios"
import js * as fs from "node:fs/promises"
import js "./polyfill.js"
import js type { AxiosRequestConfig } from "axios"
```

ESM named／default／namespace、side-effect module、CommonJS exportはRuntime意味が異なるため、形式を明示します。

## Safe Binding規則

生成するSafe FFI signatureは、すべての入力・出力に完全なRuntime descriptorを作れる場合だけ許可します。

検証済みprimitive、Option／Result、Bytes、primitive keyを持つ対応collection、有限で非再帰なNative aggregateなどを扱えます。

次は`Unknown`へfallbackするかAdapterを要求します。

- Callback／function値
- 再帰record
- 未解決または無制約generic aggregate
- Plain objectであるTypeScript `Record<K, V>`
- Object keyのJavaScript Map、identity-sensitiveなobject Set
- Conditional、mapped、intersection、overload、callable object、namespace mergingなどの未対応shape
- 未検証subshapeを含むaggregate

保守的fallbackは安全策であり、型変換成功ではありません。

## Optional値

Virune型は`T?`ですが、Interop ABI v2はJavaScript境界情報を保持します。

- Optional property欠落は`missingAsNone`で`None`にできます。
- 出力fieldは`omitWhenNone`で省略できます。
- `null`、`undefined`、nullish受入はdescriptor metadataで区別します。
- 末尾optional parameterが`None`なら、常に`undefined`を渡すのではなくcall引数自体を省略します。

## Foreign handle

Foreign値をpublic Native Virune signatureへ公開しません。監査済み操作だけを公開し、handleは`newtype`またはprivate module表現で隠します。Foreign identityをNative構造的Eqへ変換しません。

## TypeScript Adapter

npm APIがcallback、overload、class、iterable、再帰構造、JavaScript identity semanticsを使う場合はAdapterを使用します。External shapeをprimitive、検証済みNative aggregate、`Unknown`、明示Foreign handleへ変換します。

## JavaScript export

`@jsExport`には入力検証、Option／Result／Enum変換、nominal ID保持、公開Native aggregateの防御的copyを行うwrapperを生成します。Export signatureにもSafe FFIと同じ完全descriptor条件を適用します。
