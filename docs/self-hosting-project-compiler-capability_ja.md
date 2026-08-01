# Project compiler capability境界

生成済みSelf-host compilerは、次の2つのversioned JSON関数を公開する。

- `projectCompilerCapability()`
- `compileProjectMvp(request)`

これらはproject compilationのtransportを固定し、canonicalなVirune source集合全体の決定的なparseまで実行する。project linking、semantic check、emitは引き続きfail-closedである。

## Capability v1

capability objectは次を含む。

- `contractVersion`: `1`
- `requestSchema`: `virune.selfhost.project-compiler.request.v1`
- `resultSchema`: `virune.selfhost.project-compiler.result.v2`
- `ready`: candidateが完全なproject compiler artifactを生成可能か
- `blockers`: `ready`がfalseの場合のsort済みmachine-readable理由

現在のcandidateは次を返す。

```json
{
  "contractVersion": "1",
  "ready": false,
  "requestSchema": "virune.selfhost.project-compiler.request.v1",
  "resultSchema": "virune.selfhost.project-compiler.result.v2",
  "blockers": ["project-linking-not-implemented"]
}
```

Stage 1 readinessには両方のexportと`ready: true`が必要である。全sourceのparseが完了しても、linking、check、emitが未実装の間はgateを解除しない。

## Compile request v1

requestはcontract version、language version、platform、canonical entry path、完全なsource集合、emit optionを持つ。境界では次を検証する。

- contract／language version
- node platform
- 空でなく重複しないsource path
- path順のcanonical source ordering
- source集合内のentry存在
- ES2022 target
- source map無効、sources content有効

source集合が未sortの場合はparse前に`SHP1012`で失敗する。その他のcontract違反は安定した`SHP1001`〜`SHP1011`を返す。malformed JSONはResultのerror channelで失敗する。

## Project source parsing

構造的に正しいrequestでは、生成済みcompilerが既存のVirune製recursive-descent frontend parserをcanonical順に各sourceへ1回ずつ適用する。parser diagnosticはfilesystem境界を越えずに集約され、次を保持する。

- diagnostic code、severity、message
- canonical `sourcePath`
- offset／line／columnによるstart／end span
- 将来用のnotes transport

1つのsourceがmalformedでも全sourceをparseするため、結果は決定的であり、`stats.parsedModules`はrequestのsource集合全体を表す。parser errorがあればlinkingとemitへ進まない。全sourceのparseに成功した場合は、project-wide linking、checking、emissionが未実装であることを`SHP2001`で返す。

## Compile result v2

result schema v2では、path-aware diagnosticを持たない旧v1 payloadと明示的に区別する。project compiler protocolとrequest schemaはv1のままであり、consumerはprotocol versionだけでresult shapeを推定せず、capabilityの`resultSchema`を確認する。

result transportは、top-level schemaを再変更せずに将来のStage 1 compiler artifactを運べる構造を持つ。

- language version、platform、canonical entry pathのecho
- accepted／rejected状態とpath-awareな決定的diagnostic
- source path、output path、JavaScript、source map textを持つcanonical emitted module
- canonical dependency metadata
- canonical exported-symbol metadata
- parse、check、emit、reuse、invalidateのmodule統計

現在のnon-ready実装ではartifact／metadata配列を空にし、parsed module数だけを報告する。checked、emitted、reused、invalidatedの各値は0のままである。Hostはexact key、path正規化、diagnostic sourceのrequest内所属、span、canonical ordering、重複、全source coverage、emitted module数と統計の一致を検証する。rejected resultにemitted moduleを含めることは禁止する。

## 残作業

次はmodule declarationとimportを収集し、project graphの構築・検証、visibility／public API規則、linked projectのtype check、決定的なmodule別emitをこの固定transportの背後へ実装する。これらが通過した後にのみcapabilityを`ready: true`へ変更し、実際のStage 1／Stage 2生成へ進む。
