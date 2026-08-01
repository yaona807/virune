# Self-host canonical module graph

project semantics段階に向けて、Self-host Kernelへ決定的なdata-only module graph境界を追加する。

## Contract

`buildCanonicalModuleGraph`は、versioned entry path、project module、正規化済みimport recordを受け取り、次を行う。

- project-relative pathの正規化
- canonical順による連番module ID／edge IDの割当て
- filesystemやTypeScript objectを使わないVirune edge解決
- entry欠損、target欠損、duplicate import、self import、import cycleの報告
- entryからの到達可能性とunreachable moduleの記録
- 同一意味入力に対するbyte-stableなJSON-compatible dataの返却

境界入力が不正な場合は`ModuleGraphContractError`をthrowする。意味上のgraph不成立は返却値の`issues`へ保持し、`accepted`を`false`にする。

## Boundary

このsliceはfile読込、package exports解決、JavaScript実行、Production Compiler変更、最終的なLegacy diagnostic code定義を行わない。source収集とresolved import pathの供給はHostの責務とし、Interop resolution evidenceは別contractで検証する。
