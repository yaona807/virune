# Virune 1.0 規範仕様

[English](README.md)

このディレクトリは、Virune 1.0の規範的な言語契約とRuntime ABIを定義します。言語の挙動について他の説明と食い違う場合は、このディレクトリを優先します。

外部から観測できる主要な規則には、`[type.nominal-identity]`のような安定IDがあります。`rules.json`は、それらの規則を適合試験や統合試験へ対応付けます。

言語の挙動を変更する場合は、実装だけを先に変更せず、対応する仕様とテストを同じPull Requestで更新してください。互換性に影響する場合は[`COMPATIBILITY_ja.md`](../COMPATIBILITY_ja.md)にも従います。

## 文書

- `grammar.ebnf` — 規範文法と改行正規化の契約
- `lexical.md`／`lexical_ja.md` — 文字コード、トークン、コメント、文終端
- `documentation.md`／`documentation_ja.md` — ドキュメントコメント、Markdown、診断
- `types.md`／`types_ja.md` — 型同一性、推論、ジェネリック、null許容性、effect、関数と`record`
- `evaluation.md`／`evaluation_ja.md` — 評価順、制御フロー、error、cleanup
- `modules.md`／`modules_ja.md` — モジュール、import、可視性、re-export、platform
- `entry-point.md`／`entry-point_ja.md` — 実行可能な`main`のシグネチャと終了動作
- `tasks.md`／`tasks_ja.md` — 非同期処理と構造化並行処理
- `ffi.md`／`ffi_ja.md` — JavaScript境界の基本規則
- `js-interop.md`／`js-interop_ja.md` — JavaScript／TypeScript連携の規範契約
- `standard-library.md`／`standard-library_ja.md` — Bytes、固定幅整数、Unicode、collection
- `runtime-abi.md`／`runtime-abi_ja.md` — 生成コードとRuntimeの間で守るRuntime ABI v2
- `rules.json` — 仕様規則とテストの機械検査用対応表
