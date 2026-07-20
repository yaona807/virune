# TypeScript binding対応範囲

`virune bind`は、不正確な型宣言を生成するより`Unknown`へfallbackする方針です。fallbackはすべてwarningとして出力し、CLIが件数を表示します。

## 直接表現する型

- exportされたfunctionとoverload
- function型のexport variable
- readonly／optional data propertyを持つinterface
- generic record／type alias
- array、readonly array、map、set、`Record<K, V>`、`Promise<T>`、callback、optional union、primitive literal type、`Uint8Array`、`Buffer`
- rest parameterを`List<T>`へ変換

## 明示的fallbackまたは手動adapterが必要な型

一般union、intersection、tuple、conditional／mapped／indexed-access type、callable object、class、namespace、declaration merging、index signature、branded type、async iterable、lifecycleを持つAPIは、`Unknown`検証または手動adapterが必要です。

生成するsafe bindingは`Result<T, JsError>`を返します。`unsafe extern`は別の言語機能であり、暗黙には生成しません。

## 実package corpus

`corpus/bindings/packages.json`には、Zod、Fastify、React、Axios、date-fns、MySQL2、GraphQL、Vite、Hono、Valibotなど32件のnpm packageを固定versionで登録しています。現在のbaselineでは32/32 packageでbindingを生成し、function 1,791件、record 1,160件を生成しました。同時にwarning 8,591件、`Unknown` mapping 7,120件を記録しています。fallback件数は成功として隠さず、互換性reportの一部として扱います。

`npm run test:binding-corpus`は全bindingを再生成し、`corpus/bindings/report.json`のSHA-256と比較します。packageまたはTypeScript更新時は、差分を確認したうえでbaselineを明示的に更新します。
