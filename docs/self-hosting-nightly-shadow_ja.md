# セルフホスティングNightly実行evidence

[English](self-hosting-nightly-shadow.md)

Nightlyのself-host jobは、実行可能なStage 0 compiler probeと既存のSelf-host MVP differential suiteを実行し、確認用artifactとしてuploadします。

## 生成するevidence

Runnerは、同一のmaterialize済みcompiler artifactを使い、2つのcanonicalなKernel Contract v1 inputを実行します。

- `42`を返すaccepted program
- 未定義名を参照するrejected program

次を保存します。

- 正規化済みcompiler artifactとSHA-256
- accepted／rejected probe evidenceと各SHA-256 file
- GitHub candidate SHAおよびworkflow run IDに結び付いたrun manifest
- 同じworkflow artifact内の既存MVP differential report

Run manifestのclaimは`nightly-stage0-compiler-execution-probe`に固定し、`productionEligible: false`を常に記録します。

## 失敗条件

次の場合、runnerは失敗します。

- accepted inputが拒否された
- rejected inputが受理された
- 2つのprobeが異なるcompiler artifactを実行した
- candidate SHAまたはrun metadataが不正
- Stage 0 compiler候補をbuild、materialize、import、実行できない

Nightly jobは意図的にnon-blockingです。失敗はworkflowとupload済みevidenceに残りますが、pull requestのrequired checkにはならず、production compilerも切り替えません。

## 境界

このjobはStage 1／Stage 2を生成・主張しません。昇格evidenceの提供、compiler承認、branch protection変更、fixed Seed変更、grammar、stable Compiler API、Runtime ABI、Interop ABI、公開standard libraryの変更も行いません。

後続bootstrap stageでは、実行可能なcandidateがcanonicalなmulti-module Self-host source manifestをcompileできる必要があります。その出力だけをStage 1と呼び、Stage 1／Stage 2 shadow履歴へ入力できます。
