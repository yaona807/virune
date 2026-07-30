# セルフホスティングKernel data model

[English](self-hosting-kernel-model.md)

最初のVirune製Compiler Kernel sourceは[`selfhost/kernel`](../selfhost/kernel)に配置します。Stage 0用の隔離projectであり、Production TypeScript Compiler経路からはimportしません。

## 対象範囲

後続のLexer、Parser、Checker、Emitterの土台として、次のdata-only modelを定義します。

- `SourcePosition`と`SourceSpan`
- `TokenKind`と`Token`
- `DiagnosticSeverity`と`Diagnostic`
- 明示的な`NodeId`、`SymbolId`、`TypeId` record
- 明示的state passingによるimmutable generic arena
- 決定的なString／Int table
- canonical JSON表現とHost decode／encode境界

実装はrecord、enum、immutableな`List`、local変数、`Result`だけを使用します。Class、継承、reflection、unchecked cast、mutable record field、Compiler intrinsic、Self-host専用の公開stdlib APIは追加しません。

## 決定性

String／Int tableは値の完全なlistから構築します。IDを割り当てる前に値をsort・deduplicateするため、同値な入力は挿入順にかかわらず同じIDとserialized orderになります。IDは0から始まり、canonical value orderで増加します。

`encodeCanonicalKernelModel`は外部dataをderived JSON decoderでdecodeし、決定的tableを再構築してからmodelをencodeします。不正な外部dataは明示的な`Err(List<JsonError>)`として返り、Virune module内ではpanicしません。

## Host境界

`packages/compiler/src/selfhost/kernel-model-host-adapter.ts`は、生成moduleのResult-based functionをTypeScript caller向けに変換します。AdapterはSelf-hosting内部専用で、stable Compiler facadeからはexportしません。

Compiler unit testでは、現在のStage 0 Compilerでprojectをbuildし、emitted moduleをimportして、canonical round-trip、不正入力、arena allocation、存在しないIDの処理を検証します。

## Command

Virune製testを実行します。

```bash
npm run build
node packages/cli/dist/src/main.js test selfhost/kernel
```

Projectをbuildし、allocation、lookup、serializationの基礎benchmarkを実行します。

```bash
npm run build
node packages/cli/dist/src/main.js build selfhost/kernel
node scripts/benchmark-selfhost-kernel-model.mjs
```

Benchmarkはmachine-readable JSONを出力します。この段階では固定performance thresholdを設けません。代表的なLexer／Parser workloadが存在する段階でregression budgetを設定します。

## 互換性

この段階ではProduction Compiler経路、stable Compiler API、Runtime ABI、Interop ABI、grammar、言語意味論、公開stdlibを変更しません。生成projectは比較・bootstrap入力としてだけ使用します。
