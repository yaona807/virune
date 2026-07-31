# Self-host effect requirement checker

[English](self-hosting-effect-checker.md)

Effect-checking sliceは、functionの`uses`宣言とeffect requirementを決定的なJSON contractで検証します。Expression走査やcall graph推論を行わず、Virune v1 Legacy Checkerのboundedな契約を維持します。

## Built-in effect

Canonicalなeffect順序は次のとおりです。

`Console`、`Task`、`File`、`Process`、`Network`、`Timer`、`Clock`、`Storage`、`Dom`、`Random`、`JavaScript`

入力順序とduplicate entryはserializationへ影響しません。`uses *`はfunctionをwildcardとして扱い、すべての既知effect requirementを満たします。

未知の宣言effectまたはrequirementは`L2085`です。Enclosing functionに不足する既知effectは`L2076`になります。Duplicate function entryは`L1001`、空nameと未知function IDは`L9001`です。

Resultは連番function／requirement ID、canonicalなdeclared／required effect、missing effect、satisfaction判定、決定的diagnosticを返します。

```bash
npm run build
node --test --test-timeout=120000 packages/compiler/dist/test/selfhost-effect-checker.test.js
```

このsliceはexpression走査、call推論、custom effect登録、platform availability検証、async／await、defer、structured concurrency semanticsを実装しません。Self-host CheckerをProduction Compilerへ接続せず、grammar、stable Compiler API、Runtime ABI、Interop ABI、public standard libraryも変更しません。
