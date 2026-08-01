# Self-host bootstrap execution probe

bootstrap execution probeは、現在のStage 0 project buildを実行可能なcompiler候補としてmaterializeし、Kernel Contract v1の1コンパイルをその候補で実行する。

## 証明すること

- repository outputを書き込まずStage 0 buildが成功すること
- 正規化済みcompiler artifactをES moduleとしてmaterialize・importできること
- entry moduleが`compileMvp`をexportすること
- accepted／rejected compiler outputが決定的であること
- compiler artifact、canonical input、canonical outputがSHA-256で証拠へ拘束されること

証拠のclaimは常に`stage0-compiler-execution-probe`であり、`productionEligible`は常に`false`である。

## 証明しないこと

このprobeは、候補compilerがmulti-module Self-host Kernel sourceを再構築したこと、Stage 1／Stage 2を生成したこと、full differentialを通過したこと、production昇格可能であることを主張しない。

## 次のbootstrap段階

次はsingle-source probe inputをversioned project-compilation boundaryへ置き換え、実行可能な候補compilerがcanonical Self-host source manifestをコンパイルできるようにする。その出力だけをStage 1と呼ぶ。
