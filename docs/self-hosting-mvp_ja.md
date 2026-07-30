# セルフホスティングCompiler MVP

[English](self-hosting-mvp.md)

最初のVirune製縦断Compiler sliceは[`selfhost/mvp`](../selfhost/mvp)に配置します。Stage 0用の隔離projectであり、Production Compiler経路からは選択されません。

## 対応範囲

MVPは次のpipelineをViruneで実装します。

1. source position／spanを保持する決定的tokenization
2. 単一module function向けの直接AST parsing
3. function symbol登録とlocal binding検査
4. primitive type checkingと明示的HIR lowering
5. readableなES2022 module body emission

対象とする言語subsetは意図的に限定しています。

- `fn`、`let`、`return`
- `Bool`、`Int`、`Float`、`String`、`Unit`
- identifierとfunction call
- unary `!`／`-`
- 算術、比較、等価、論理binary operator
- 型付きfunction parameterとreturn type

Import、record、enum、newtype、generics、pattern matching、effect、async、parallel、defer、JavaScript interop、Production切り替えはこのmilestoneの対象外です。

## Host境界

生成されたVirune moduleは、Result-basedなJSON functionを1つ公開します。内部TypeScript adapterはその結果を検証し、Kernel Contract v1へ変換します。正確なRuntime import lineと最終source-map encodingはHostが担当します。MVP differential fixtureではsource mapを無効にし、生成source-map fieldを無視せずにJavaScriptとruntime behaviorを比較します。

AdapterはNode platformのsource moduleを1件だけ受け付け、未対応のInterop Manifest entryまたはsource-map requestを拒否します。Self-hosting内部専用であり、stable Compiler APIからはexportしません。

## Differential検証

MVP corpusには、算術／call、primitive／logicのaccepted fixtureと、unknown-nameのrejected fixtureを収録します。Differential runnerは次を比較します。

- accepted／rejected
- diagnostic code、severity、message、span
- exported symbol
- emitted JavaScript
- runtime return value、stdout、stderr、exit code、panic data

MVP fixtureにはexpected divergenceを設定しません。

## Command

```bash
npm run selfhost:mvp:check
npm run selfhost:mvp:test
npm run selfhost:mvp:differential
```

通常のcore suiteでもVirune製MVP testを実行します。

## 互換性

このmilestoneではProduction Compiler選択、stable Compiler API、Runtime ABI、Interop ABI、規範grammar、言語意味論、公開stdlibを変更しません。Base Runtime import constantの共有はbehavior-neutralであり、対象sliceにおけるProduction／Self-host emissionのbyte一致を維持するためのものです。
