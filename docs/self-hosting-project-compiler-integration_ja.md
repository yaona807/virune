# Project Compiler Integration

`project-compiler-contract.virune`は、分離して実装した4つのセルフホスティングレーンを、1つのversioned project境界へ統合する。

1. Virune製frontend parserでcanonical sourceをすべてparseする
2. project module graphを構築・検証する
3. project semantic contextを構築する
4. 既存Pure Core MVP pipelineでmoduleをloweringする
5. project emitterで決定的なES2022 moduleを組み立てる

受理されたMVP moduleには決定的なruntime importを付与し、canonical source順で`.selfhost-output/`へemitする。parser、linker、semantic、loweringのdiagnosticはpath-awareかつfail-closedを維持する。

capabilityは意図的に`ready: false`とし、blockerに`full-language-lowering-not-implemented`を残す。この統合はdata flowと実行可能なmulti-module artifact contractを成立させるが、record、enum、generic、effect、asyncなどのfull-language構文がすでに自己コンパイル可能だとは扱わない。次のsliceでMVP loweringを完全なfrontend HIR／emitterへ置き換える。
