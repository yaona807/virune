# Incremental compilation

Viruneは、editorとwatch mode向けにstatefulなincremental project compilerを提供します。通常のCLI buildはstateを保持せず、決定的なone-shot buildのままです。

## Cache model

`IncrementalProjectBuilder`はmodule単位で次を保持します。

- 安定したfile identity
- source content hash
- parse済みASTとparser diagnostic
- canonical化したpublic interface hash
- 依存moduleのinterface fingerprint
- semantic model
- 生成済みJavaScriptとsource map

source hashが変わったmoduleだけを再parseします。module自身のsource、compiler設定、または直接依存するmoduleのpublic interfaceが変わった場合だけ、型検査とemitを再実行します。

そのため実装だけの変更では変更moduleのみを再compileし、依存moduleを再利用します。public signatureが変わった場合は、変更moduleとdependency fingerprintが変わった直接依存moduleを再compileします。

## API

cache表現と無効化戦略はstable 1.0までに変更する可能性があるため、このAPIはexperimentalです。

```typescript
import { IncrementalProjectBuilder } from '@virune/compiler/experimental';

const builder = new IncrementalProjectBuilder();
const first = await builder.build(projectRoot, { write: false });
const next = await builder.build(projectRoot, { write: false });

console.log(next.stats.reusedParsedModules);
```

特定moduleを明示的に破棄する場合は`invalidate(path)`、全stateを破棄する場合は`clear()`を使用します。

## Language Serverとの統合

Virune Language Serverはproject rootごとに1つのincremental builderを保持します。未保存bufferはoverlay project hostから供給します。parse・型検査・emitを再利用できるかはsource hashで判断するため、editor snapshotを無効化してもproject全体を無条件に再構築しません。

## Benchmark

次を実行します。

```bash
npm run benchmark:incremental
```

100、500、1,000 moduleのprojectについて、clean、変更なし、実装変更、public signature変更のbuild結果を`benchmarks/incremental/latest.json`へ記録します。実行時間は環境依存です。`stats`の処理module数を正しさの指標とし、時間は性能保証ではなく診断情報として扱います。
