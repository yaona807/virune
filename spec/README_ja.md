# Virune 1.0 規範仕様

[English](README.md) | [日本語](README_ja.md)

このディレクトリが、Virune 1.0の規範的な言語契約です。ほかの解説文書と内容が矛盾する場合は、本ディレクトリを優先します。Runtime ABI v2の規範的な内容は`runtime-abi_ja.md`にあります。

外部から観測できる規則には、`[type.nominal-identity]`のような安定IDがあります。`rules.json`は主要規則と適合試験・統合試験の対応を記録します。言語の挙動を変えない編集上の修正は可能ですが、1.0以降の振る舞いを変える場合は互換性方針に従います。

## 文書

- `grammar.ebnf` — 完全な規範文法と改行正規化契約
- `lexical.md`／`lexical_ja.md` — 文字コード、トークン、コメント、文終端
- `documentation.md`／`documentation_ja.md` — ドキュメントコメントの関連付け、Markdown、診断
- `types.md`／`types_ja.md` — 型同一性、推論、ジェネリック、null許容性、エフェクト、関数recordの合成
- `evaluation.md`／`evaluation_ja.md` — 評価順、制御フロー、エラー、後始末
- `modules.md`／`modules_ja.md` — module、import、可視性、re-export、platform
- `entry-point.md`／`entry-point_ja.md` — `main`シグネチャと終了動作
- `tasks.md`／`tasks_ja.md` — 非同期実行と構造化並行処理
- `ffi.md`／`ffi_ja.md` — JavaScript境界
- `js-interop.md`／`js-interop_ja.md` — 規範的なJavaScript／TypeScript相互運用契約
- `standard-library.md`／`standard-library_ja.md` — Bytes、固定幅整数、Unicode、コレクション
- `runtime-abi.md`／`runtime-abi_ja.md` — 生成コードとRuntimeの間のRuntime ABI v2契約
- `rules.json` — 仕様とテストの機械検査用対応表
