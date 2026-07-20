# Stable release gate

Viruneを`stable` channelへ昇格できるのは、次の条件をすべて満たした場合だけです。

- Formatterがcommentの意味的な関連先を保持し、冪等であり、regression／fuzz testが成功する。
- scope完了前にすべての子taskをcancelしてsettleまで待ち、timeout・兄弟失敗経路がNode.js／browser Runtimeで成功する。
- stable Compiler API snapshotとpackage export mapの互換性検査が成功する。
- 文書fileをtest扱いせず、規範rule coverageが100%である。
- clean installからNode.js／browser conformance suiteが成功する。
- FFIのUnknown fallbackとunsafe境界を報告・文書化する。
- Parser、Formatter、Checkerのcrash fuzz testが成功する。
- 公開packageをclean environmentへinstallして実行できる。
- 固定したnpm binding corpusがreview済みhashを再現し、success／non-empty thresholdを満たす。
- scheduled long fuzzingの実行履歴が蓄積され、未解決のcrash regressionがない。
