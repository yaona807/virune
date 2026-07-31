# Self-host async／await validation

[English](self-hosting-async-await.md)

このboundedなType／Effect Checker sliceは、Legacyのasync context、await operand、JavaScript effect validationを決定的なdata-only contractとして再現します。

## Rule

- Canonical context arenaとawait-expression arenaは連番IDを使用します。
- Async function／async test contextでは`await`を受理し、それ以外は`L2022`です。
- `Future<T>`は、検証済みHost contractから渡されたawaited type `T`を返します。
- Foreign JavaScript valueは、Hostが空でないPromiseLike awaited typeを渡した場合だけawait可能です。
- Future／PromiseLike以外のoperandは`L2023`です。
- Foreign awaitには`uses JavaScript`または`uses *`が必要で、不足時は`L2076`です。
- 複合失敗ではLegacyと同じ`L2022`、`L2076`、`L2023`の順序を維持します。
- Duplicate context nameは`L1001`です。
- Unknown context／operand kind、空のtype handle、Future value type欠落、不正なreferenceはboundedな`L9001` diagnosticになります。

JSON resultはcanonical context／expression、result type、context／operand判定、required／missing effect、決定的diagnostic、aggregate accepted flagを保持します。

```bash
npm run build
node --test --test-timeout=120000 packages/compiler/dist/test/selfhost-async-await.test.js
```

このsliceは、解決済みoperand／awaited type nameを入力として受け取ります。JavaScript PromiseLike objectの調査、type inference、async state machine lowering、scheduler／cancellation、Production Parser／Checker接続は実装せず、grammar、stable Compiler API、Runtime ABI、Interop ABI、public standard libraryも変更しません。
