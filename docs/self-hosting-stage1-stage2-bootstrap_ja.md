# Stage 1／Stage 2 bootstrap readiness

readiness evaluatorは、実際のStage 1／Stage 2生成へ進む直前の前提条件を正直に検証する。

現在の生成済みSelf-host MVP候補は`compileMvp(source: string)`をexportする。Host adapterは意図的にsource moduleを1件だけ受け付ける。一方、Self-host compiler project本体はmulti-moduleであるため、この境界ではCompiler全体の正しいStage 1 artifactを生成できない。

## evaluatorが行うこと

- 実際のStage 0 compiler artifactをbuild・正規化する
- 生成済みStage 0 entry moduleをmaterialize・loadする
- project内の全sourceから完全なcanonical Kernel Contract inputを構築する
- inputをcanonical source-manifest SHA-256へ拘束する
- 必須exportである`compileProjectMvp`の有無を確認する
- 決定的かつ昇格不可のreadiness evidenceを出力する

証拠のclaimは`stage1-stage2-bootstrap-readiness`で、`productionEligible`は常に`false`である。

## 現在の結果

現在のSelf-host MVPでは、次の2 blockerを報告することが期待される。

- `multi-module-project-requires-project-compiler`
- `project-compiler-export-missing`

これはFail Closed検査の成功結果であり、Stage 1の失敗でもStage 1 artifactでもない。single-source compilerをself-host完了と誤表示することを防ぐ。

## 次に必要な実装

生成済みcompiler候補へ、完全なcanonical source集合、module graph、entry path、emit optionを受け取るversioned `compileProjectMvp`境界を追加する必要がある。このexportが実装されると同じreadiness gateが通過し、Stage 0→Stage 1→Stage 2生成とStage 1／Stage 2 artifact一致検証へ進める。

## 境界

このevaluatorはStage 1／Stage 2を生成せず、Production Parser／Checkerの切替、固定Seed更新、workflow／branch protection変更、昇格承認も行わない。
