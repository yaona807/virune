# Self-host parallel validation

[English](self-hosting-parallel.md)

このboundedなType Checker sliceは、Legacyの`parallel`／`parallel try` entry validationを決定的なdata-only contractとして再現します。

## Rule

- Canonical entry IDはrequest順の連番です。
- Duplicate entry nameは`L2036`です。
- Future以外のentryは`L2037`です。
- `parallel try`でFutureの値がResultでないentryは`L2038`です。
- `parallel try`でResult error typeが異なるentryは`L2039`です。
- Duplicate fieldは最初の挿入順を維持しながら後のentryでfield typeを置換し、LegacyのMap挙動を再現します。
- 複合失敗ではentry単位のLegacy診断順序とshort-circuitを維持します。
- Unknown operand kind、空のname／type handle、Future value type欠落、空のexpressionはboundedな`L9001` diagnosticになります。

JSON resultはentry、canonical field、共通try error type、計算済みresult type、entryごとのvalidation判定、決定的diagnostic、aggregate accepted flagを保持します。

```bash
npm run build
node --test --test-timeout=120000 packages/compiler/dist/test/selfhost-parallel.test.js
```

このsliceは解決済みoperand／value／error type nameを入力として受け取ります。Type inference、Future objectの調査、task lowering、scheduler、cancellation、child-task lifecycle、Production Parser／Checker接続は実装せず、grammar、stable Compiler API、Runtime ABI、Interop ABI、public standard libraryも変更しません。
