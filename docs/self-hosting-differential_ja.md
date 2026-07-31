# セルフホスティング差分検証harness

[English](self-hosting-differential.md)

差分検証harnessは、Legacy TypeScript Compilerと将来のVirune Compiler Kernelへ、同一のversioned `KernelInput` contractを渡して比較します。Self-hosting内部専用であり、Production Compiler facadeは変更しません。

## 比較対象

左右を独立してcompileし、正規化したうえで次を比較します。

- accepted／rejected状態
- diagnostic code、severity、source range、related情報、help、fix、panic情報
- exported symbolとdependency metadata
- emitted JavaScript moduleと、parse後にcanonical serializeしたsource map
- compilation statistics
- runtime return value、stdout、stderr、exit code、signal、panic、出力event順序

fieldを暗黙には無視しません。集合として扱うarrayはcanonical sortし、object keyは順序を固定し、改行コードとproject-relative pathを正規化します。それでも残る差分は、有効なfixture policyで説明されるか、比較失敗になります。

## ローカルのsmoke corpus

Repositoryをbuildし、現在のLegacy実装を左右へ接続して自己比較します。

```bash
npm run selfhost:differential:smoke
```

Fixtureを1件だけ実行する場合は次を使用します。

```bash
npm run build
node scripts/run-selfhost-differential.mjs --fixture=smoke-multi-module
```

Commit済みcorpusは`.github/self-hosting/differential-corpus-v1.json`です。Fixtureにはtagがあり、compiler unit、conformance、fuzz regression、binding、browser corpusをreport形式を変えずに段階的に接続できます。

既定のartifactは次のとおりです。

- `.cache/selfhost-differential/smoke/report.json`: machine processing用
- `.cache/selfhost-differential/smoke/summary.md`: review用

JSONにはfixtureと、差分が存在する正確なJSON pathが記録されます。

## Expected divergence policy

Expected divergenceは、1件のfixtureと1件の正確なreport pathに紐付けます。次を必須とします。

- 空ではない理由
- ISO `YYYY-MM-DD`形式の期限
- `$.runtime.returnValue`のような正確なpath

期限切れpolicyは比較前に失敗します。差分が解消して一致対象がなくなったpolicyもstaleとして失敗し、削除を強制します。説明されていない差分は常に失敗します。Harnessがpolicyを自動追加・自動承認することはありません。

## Runtime比較

Node executorはemitted moduleを`.cache`配下の隔離directoryへ書き込み、entry moduleをimportし、公開された`main`関数をawaitして、JSON-safeなreturn valueを記録します。Panic内の一時pathだけを正規化し、program outputとevent順序はそのまま比較します。Compilerがrejectした出力は実行しません。

## CIへの導入

Smoke commandは、最初は非blocking CI stepとして接続できます。

```yaml
- name: Self-host differential smoke
  continue-on-error: true
  run: npm run selfhost:differential:smoke
```

実際のSelf-host Kernelを接続し、Self-hosting Architectureの昇格条件を満たすまでは非blockingを維持します。その段階で右側のKernelだけを差し替え、corpusとartifact形式は変更しません。

## Parser parity corpus

Version管理された`.github/self-hosting/parser-parity-corpus-v1.json`で、Production Legacy lexer／parserとVirune Stage 0 frontendを比較します。Virune 1.0 grammarの各構文群についてaccepted／rejectedを比較し、単一破損caseでは公開Parser diagnostic契約である`code`、`severity`、source rangeを比較します。Chevrotain由来の歴史的なinclusive `endOffset`をHost境界で正規化します。zero-width parser diagnosticではend columnもstart columnへ正規化し、それ以外のline／columnは変更しません。決定的なbounded mutationで進行保証、canonical arena ID、panic不在を検証します。

ローカル実行:

```bash
npm run selfhost:parser:parity
```

Expected divergenceには正確なcaseとJSON path、理由、期限内のISO日付が必要です。未説明差分、stale policy、expired policyは失敗します。

## Data type semantic table

Type／Effect Checkerの第1段階では、typed Stage 0 frontend resultからrecord、enum、newtype、type aliasのcanonical declaration／member／type arenaを構築します。Builtin type、同一moduleの宣言、宣言type parameterを解決し、duplicate definition、duplicate type parameter、unknown type、generic arity mismatchを安定したdiagnostic code・source range・helpでrejectします。

Semantic JSON境界はParser実装型を再公開せず、独自のsource position recordを保持します。Arena IDは連番で、すべての参照IDをHost testが検証し、同じsourceの繰り返しcompileは完全に同じserializationを返す必要があります。

対象検証:

```bash
npm run build
node --test --test-timeout=120000 packages/compiler/dist/test/selfhost-semantic-data-types.test.js
```

この段階ではProduction Parser／Checkerを変更せず、Self-host KernelをProduction経路へ接続しません。

## Generic instantiation table

意味論第2段階では、同一moduleのgeneric data type適用をdeclaration IDとcanonical argument type ID列でinternします。各instantiationは置換済みmember type IDまたはunderlying target typeを保持します。置換前にplaceholderを登録するためrecursive record／aliasも決定的に停止し、同一適用は1つのinstantiation IDを再利用します。Recursive generic aliasは無限展開せず`L2042`を返します。

## Collection type operations

意味論第3段階では、canonical semantic arena上で純粋な型関係を評価します。Tuple、`List`、`Map`、`Set`、`Option`、`Result`の構造比較、`Never`／`Unknown`境界、optional lifting、alias透過、再帰的な`Eq`／`Hash`／`Json`／`Debug` capability判定を扱います。Newtypeはassignabilityでは名目的境界を維持し、capability判定ではunderlying typeを参照するため、Legacy Checkerの境界と一致します。

JSON contractはtype aliasを安定した操作handleとして受け取り、canonical type ID、component ID、relation結果、common type結果を返します。Trait結果では、参照する型graphに未解決のtype parameterが残っているかも明示します。公開するのは文字列ベースのJSON adapterだけで、typed request／result recordはmodule-privateとし、semantic実装型を再公開しません。互換性のないcommon typeは`L2042`、存在しない操作対象は`L2040`になります。同一requestは完全に同じserializationを返し、返却されたすべてのIDをHost testで検証します。

対象検証:

```bash
npm run build
node --test --test-timeout=120000 packages/compiler/dist/test/selfhost-type-operations.test.js
```

このmoduleはProduction Checkerから隔離し、grammar、stable Compiler API、Runtime ABI、Interop ABI、public stdlibを変更しません。
