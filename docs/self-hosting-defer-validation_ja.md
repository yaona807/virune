# Self-host defer validation

[English](self-hosting-defer-validation.md)

このboundedなType／Effect Checker sliceは、Legacyの`defer` contextおよびexpression result validationを、決定的なdata-only contractとして再現します。

## Rule

- Canonical scope arenaとdefer-statement arenaは連番IDを使用します。
- Function scopeとtest scopeでは`defer`を受理します。
- Module scopeでは`L2070`を返します。
- Inferred typeが`Unit`または`Never`のdeferred expressionは有効です。
- それ以外の空でないinferred typeは`L2071`を返します。
- Contextとresult typeの両方が不正な場合は、Legacyの検証順序に合わせて`L2070`、`L2071`の順で返します。
- Duplicate scope nameは`L1001`です。
- Unknown scope kind、空のname／type handle、不正なscope referenceはboundedな`L9001` diagnosticになります。

Resultはcanonicalなscope／statement arena、statementごとのcontext／type判定、決定的diagnostic、aggregate accepted flagを保持します。

```bash
npm run build
node --test --test-timeout=120000 packages/compiler/dist/test/selfhost-defer-checker.test.js
```

このsliceは、すでに推論済みのexpression type nameを入力として受け取ります。Expression type inference、cleanup順序のlowering、effect aggregation、async／await、structured concurrency、Production Parser／Checker接続は実装せず、grammar、stable Compiler API、Runtime ABI、Interop ABI、public standard libraryも変更しません。
