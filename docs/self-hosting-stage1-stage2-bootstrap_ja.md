# 実際のStage 1／Stage 2 bootstrap

Stage bootstrap runnerは、実行可能なSelf-host MVP境界を通してCompilerを実際に2回生成する。

1. 既存のStage 0 project buildを正規化し、実行可能なcompiler候補としてloadする。
2. Stage 0がcanonical Self-host MVP source inputをcompileし、Stage 1 compiler artifactを生成する。
3. Stage 1 artifactをmaterialize・loadし、次のcompiler候補とする。
4. Stage 1が同じsource inputをcompileし、Stage 2を生成する。
5. 既存のbootstrap shadow reportで、Stage 1とStage 2の差分が`metadata.stage`だけであることを必須にする。

## 証拠の境界

両Stageは同じcanonical source-manifest SHA-256へ拘束される。各生成では次を含む独立した証拠を出力する。

- 生成したStage
- 生成を実行したcompiler artifactのSHA-256
- source manifestのSHA-256
- 生成したartifactのSHA-256
- 生成compilerのentry module

入力compiler SHAは、意図的にnormalized artifact metadataの外へ置く。Stage 1はStage 0、Stage 2はStage 1によって生成されるため、このSHAをartifact内へ入れると、正当だが再現不能なStage 1／Stage 2差分になる。

generation evidence単体では昇格できず、常に`productionEligible: false`を記録する。

## 現在の範囲

現在のrunnerはsingle-source Self-host MVP compilerを対象とする。Production Parser／Checkerの切替、固定Seedの更新、workflow／branch protectionの変更、昇格承認は行わない。multi-module Kernelの自己生成は同じ境界を拡張する後続段階である。

## Fail Closed方針

compileがrejectされた場合、error diagnosticが出た場合、compiler entryが欠落または複数存在する場合、生成artifactに予期しないsource mapが含まれる場合、Stage 1／Stage 2 shadow reportに未説明差分がある場合は失敗として停止する。
