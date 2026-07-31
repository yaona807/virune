# Self-host symbol scope arena

Self-host Checkerは、式の型検査へ接続する前段階として、lexical scopeとsymbolを決定的なdata-only arenaで表現します。

## Scope model

- Scope IDはrequest順の連番です。
- scope kindは`module`、`function`、`block`です。
- module scopeはparentを持ちません。
- function／block scopeは先に登録されたscopeをparentとして参照するため、parent graphは構造上acyclicです。
- 各scopeはownerとなるcanonical AST node IDを保持します。

## Symbol model

Symbolは`value`、`type`、`capability` namespaceへ分離します。異なるnamespaceでは同じ名前を共存させられます。同一scope・同一namespaceのduplicateは`L1001`となり、arenaへ追加しません。

親scopeに同じ名前・namespaceのsymbolがある場合は、最も近いsymbolを`shadowsSymbolId`として記録します。Shadowingはsame-scope duplicateとは区別します。

## Lookup

Lookupは指定scopeから開始し、同じnamespace・nameのsymbolが見つかるまでparent scopeを遡ります。存在しないsymbolは`L2040`です。不正なscope参照、namespace、owner ID、source ID、循環を作るparent指定はpanicせず`L9001` diagnosticになります。

Focused Host testでは、serializationの決定性、連番ID、parent参照、namespace分離、shadowing、nearest lookup、duplicate reject、不正入力処理を検証します。

```bash
npm run build
node --test --test-timeout=120000 packages/compiler/dist/test/selfhost-symbol-scope.test.js
```

この段階ではmulti-module visibilityを実装せず、Self-host arenaをProduction Checkerへ接続しません。Grammar、stable Compiler API、Runtime ABI、Interop ABI、public standard libraryも変更しません。
