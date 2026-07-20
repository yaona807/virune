# Fuzzing

Viruneは、決定的なregression fuzz testと長時間nightly property suiteを組み合わせます。

## 検証する不変条件

長時間suiteでは次を検証します。

- 任意入力でlexer、parser、checker、compiler、formatterがthrowしない
- diagnostic spanが有限値で、順序が正しく、source file内に収まる
- 同一入力の再compileでdiagnosticとoutputが一致する
- parse可能な入力をformatした後もparse可能である
- formatが冪等である
- comment tokenの順序とtextを保持する

## Local実行

```bash
npm run test:fuzz:smoke
VIRUNE_FUZZ_DURATION_MS=900000 VIRUNE_FUZZ_SHARD=0 npm run test:fuzz:long
```

generatorはseed付きで決定的です。特定streamを再現する場合は`VIRUNE_FUZZ_SEED`を指定します。

## 失敗時の扱い

失敗するとsourceとJSON metadataを`fuzz-regressions/artifacts/`へ保存します。nightly CIは成功・失敗にかかわらずこのdirectoryをartifactとして保存します。確認済みの失敗は最小化し、対応packageの決定的fixtureへ移してから解決済みとします。

このリポジトリに含まれるのは実行基盤と決定的regression corpusです。長時間実行の履歴はscheduled workflowの実行後から蓄積されるものであり、workflowが存在するだけで実績があるとは扱いません。
