# Project compiler capability境界

生成済みSelf-host compilerは、次の2つのversioned JSON関数を公開する。

- `projectCompilerCapability()`
- `compileProjectMvp(request)`

これらは、project-wide意味論を実装する前にproject compilationのtransportを固定する。

## Capability v1

capability objectは次を含む。

- `contractVersion`: `1`
- `requestSchema`: `virune.selfhost.project-compiler.request.v1`
- `resultSchema`: `virune.selfhost.project-compiler.result.v1`
- `ready`: candidateが完全なproject compiler artifactを生成可能か
- `blockers`: `ready`がfalseの場合のsort済みmachine-readable理由

現在のcandidateは次を返す。

```json
{
  "contractVersion": "1",
  "ready": false,
  "requestSchema": "virune.selfhost.project-compiler.request.v1",
  "resultSchema": "virune.selfhost.project-compiler.result.v1",
  "blockers": ["project-semantics-not-implemented"]
}
```

Stage 1 readinessには両方のexportと`ready: true`が必要である。stubの`compileProjectMvp`関数だけではgateを解除できない。

## Compile request v1

requestはcontract version、language version、platform、canonical entry path、完全なsource集合、emit optionを持つ。現在の境界は次を検証する。

- contract／language version
- node platform
- 空でなく重複しないsource path
- source集合内のentry存在
- ES2022 target
- source map無効、sources content有効

構造的に正しいrequestには、diagnostic `SHP2000`を含む決定的なrejected evidenceを返す。無効なcontract dataには安定した`SHP1001`〜`SHP1011`を返し、malformed JSONはResultのerror channelで失敗する。

## 残作業

次は、この固定transportの背後へproject-wide declaration収集、import解決、visibility検証、type check、決定的なmodule別emitを実装する。これらが通過した後にのみcapabilityを`ready: true`へ変更し、実際のStage 1／Stage 2生成へ進む。
