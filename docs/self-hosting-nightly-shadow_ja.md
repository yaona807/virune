# セルフホスティングNightly実行evidence

[English](self-hosting-nightly-shadow.md)

Nightlyのself-host jobは、実行可能なStage 0 compiler probe、固定SeedによるStage 1 → Stage 2 transitionとStage 2 → Stage 3 fixed-point shadow、既存のSelf-host MVP differential suiteを実行し、確認用evidenceとしてuploadします。

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

Stage 0 probeの後、Nightlyは固定Seedに対して`run-selfhost-fixed-seed-bootstrap.mjs`を実行します。RunnerはSeedを検証し、同一のcurrent Self-host sourceからStage 1、Stage 2、Stage 3を生成して、次を保存します。

- `.cache/selfhost-nightly-shadow/fixed-seed-bootstrap.json`
- `.cache/selfhost-nightly-shadow/fixed-seed-bootstrap.progress.json`

固定Seed evidenceのclaimは`fixed-seed-bootstrap-fixed-point`で、`productionEligible: false`を常に記録します。検証済みSeed hash、Stage 1／Stage 2／Stage 3のnormalized SHA-256とmodule数、Stage 1 → Stage 2 transition差分、Stage 2 → Stage 3 fixed-point比較を記録します。

Stage 1 → Stage 2はhistorical Seed generatorからcurrent Self-host generatorへの**transition evidence**です。差分は記録して可視性を保ちますが、それ自体をfixed-point失敗とは扱いません。

固定点の必須条件は **Stage 2 == Stage 3** です。normalized Stage 2／Stage 3 artifactがequivalentかつSHA-256一致の場合だけrunnerは成功し、それ以外はevidenceを書き込んだうえでfail-closedします。

## 失敗条件

Stage 0 probeは次の場合に失敗します。

- accepted inputが拒否された
- rejected inputが受理された
- 2つのprobeが異なるcompiler artifactを実行した
- candidate SHAまたはrun metadataが不正
- Stage 0 compiler候補をbuild、materialize、import、実行できない

固定Seed stepは、pinned Seedを検証・loadできない、必要stageを生成・実行できない、またはStage 2／Stage 3がexact normalized fixed pointへ到達しない場合にfail-closedします。Stage 1 → Stage 2差分はtransition evidenceとして残し、それ単独ではfixed-point checkを失敗させません。

Nightlyのself-host jobは意図的にnon-blocking（`continue-on-error: true`）です。後続MVP evidenceとartifact uploadは`always()`を使うため、shadow evidenceが失敗しても確認可能な状態を保ち、pull requestのrequired check化やproduction compilerの切替は行いません。

## 境界

このjobが記録するのはnon-promotableなshadow evidenceです。compiler承認、branch protection変更、fixed Seed変更、production default切替、grammar、stable Compiler API、Runtime ABI、Interop ABI、公開standard libraryの変更は行いません。

Production昇格は#99とcandidate-bound evidenceに基づく別個のfail-closed判定です。Nightly成功だけでartifactがproduction-eligibleになることはありません。
