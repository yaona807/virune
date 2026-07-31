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

Version管理された`.github/self-hosting/parser-parity-corpus-v1.json`で、Production Legacy lexer／parserとVirune Stage 0 frontendを比較します。Virune 1.0 grammarの各構文群についてaccepted／rejectedを比較し、単一破損caseでは公開Parser diagnostic契約である`code`、`severity`、source rangeを比較します。Chevrotain由来の歴史的なinclusive `endOffset`だけをHost境界で正規化し、line／columnは変更しません。決定的なbounded mutationで進行保証、canonical arena ID、panic不在を検証します。

ローカル実行:

```bash
npm run selfhost:parser:parity
```

Expected divergenceには正確なcaseとJSON path、理由、期限内のISO日付が必要です。未説明差分、stale policy、expired policyは失敗します。
