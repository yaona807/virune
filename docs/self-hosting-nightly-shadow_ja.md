# セルフホスティングNightly実行evidence

[English](self-hosting-nightly-shadow.md)

Nightlyのself-host jobは、実行可能なStage 0 compiler probe、Stage 1／Stage 2 bootstrap shadow、既存のSelf-host MVP differential suiteを実行し、確認用artifactとしてuploadします。

## 生成するevidence

Stage 0 runnerは、同一のmaterialize済みcompiler artifactを使い、2つのcanonicalなKernel Contract v1 inputを実行します。

- `42`を返すaccepted program
- 未定義名を参照するrejected program

次を保存します。

- 正規化済みStage 0 compiler artifactとSHA-256
- accepted／rejected probe evidenceと各SHA-256 file
- GitHub candidate SHAおよびworkflow run IDに結び付いたrun manifest
- 同じworkflow artifact内の既存MVP differential report

Stage 0 run manifestのclaimは`nightly-stage0-compiler-execution-probe`に固定し、`productionEligible: false`を常に記録します。

Stage 0 probeの後、Nightlyはrepository管理の`selfhost:bootstrap:built` runnerを実行します。checked-inされたStage readiness witnessを評価し、canonicalなSelf-host projectをbuildし、readinessが許可する場合は実際にemitされたartifactを通じてStage 1とStage 2を実行し、`.cache/selfhost-nightly-shadow/bootstrap-stages.json`へ保存します。

このJSON evidenceはclaimに`stage1-stage2-bootstrap`を使用し、`productionEligible: false`を常に記録したうえで、次を報告します。

- readiness evidenceとそのSHA-256
- 実行された場合のStage 1／Stage 2 normalized artifact SHA-256とmodule数
- `blocked`、`match`、`mismatch`のstatus
- normalized artifactが一致しない場合のcanonicalなmodule単位diff

## 失敗条件

Stage 0 probeは次の場合に失敗します。

- accepted inputが拒否された
- rejected inputが受理された
- 2つのprobeが異なるcompiler artifactを実行した
- candidate SHAまたはrun metadataが不正
- Stage 0 compiler候補をbuild、materialize、import、実行できない

Stage 1／Stage 2 bootstrap stepは、readinessがblockedの場合またはnormalized artifactが異なる場合、JSON evidenceを書き込んだ後に失敗します。projectをbuildできない場合や、readyなStage compilerを実行・materializeできない場合もfail-closedです。

Nightlyのself-host jobは意図的にnon-blocking（`continue-on-error: true`）です。後続のevidence stepとartifact uploadは`always()`を使うため、Stage 0またはStage 1／Stage 2 probeが失敗しても確認可能な状態を保ち、pull requestのrequired check化やproduction compilerの切替は行いません。

## 境界

このjobはStage 0およびStage 1／Stage 2のshadow evidenceを記録しますが、それらのartifactがcompilerを承認・昇格することはありません。branch protection変更、fixed Seed変更、production default切替、grammar、stable Compiler API、Runtime ABI、Interop ABI、公開standard libraryの変更も行いません。

昇格は、checked-inされたpromotion policyとcandidate-bound evidenceに基づく、別個のfail-closedなHost判定として維持されます。
