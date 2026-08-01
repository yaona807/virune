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

## Compile result v1

result transportは、top-level schemaを変更せずに将来のStage 1 compiler artifactを運べる構造を持つ。

- language version、platform、canonical entry pathのecho
- accepted／rejected状態と決定的なdiagnostic
- source path、output path、JavaScript、source map textを持つcanonical emitted module
- canonical dependency metadata
- canonical exported-symbol metadata
- parse、check、emit、reuse、invalidateのmodule統計

現在のnon-ready実装ではartifact／metadata配列を空、統計を0として返す。rejected resultにemitted moduleを含めることは禁止し、Hostはcanonical order、重複、path正規化、exact key、emitted module数と統計の一致を検証する。以前のcount-only shapeは実際のStage 1 artifactを運べないため拒否する。

構造的に正しいrequestには、diagnostic `SHP2000`を含む決定的なrejected evidenceを返す。無効なcontract dataには安定した`SHP1001`〜`SHP1011`を返し、malformed JSONはResultのerror channelで失敗する。

## 残作業

次は、この固定transportの背後へproject-wide declaration収集、import解決、visibility検証、type check、決定的なmodule別emitを実装する。これらが通過した後にのみcapabilityを`ready: true`へ変更し、実際のStage 1／Stage 2生成へ進む。
