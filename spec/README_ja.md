# Virune 1.0 規範仕様

[English](README.md) | [日本語](README_ja.md)

このディレクトリのファイルはVirune 1.0の規範的な言語契約を定義します。解説文書と本ディレクトリが矛盾する場合、本ディレクトリを優先します。Runtime ABI v2は`../docs/runtime-abi_ja.md`に記載します。

外部から観測可能な規則には`[type.nominal-identity]`のような安定IDがあります。`rules.json`は主要規則を適合試験または統合試験へ関連付けます。言語を変更しない編集上の修正は可能ですが、1.0以降の振る舞い変更は互換性方針に従います。

学習順に読める解説は[言語ガイド](../docs/language-guide_ja.md)を参照してください。

## 文書

- `grammar.ebnf` — 完全な規範文法と改行正規化契約
- `lexical.md`／`lexical_ja.md` — 文字コード、token、comment、文終端
- `documentation.md`／`documentation_ja.md` — ドキュメントコメントの関連付け、Markdown、診断
- `types.md`／`types_ja.md` — 型同一性、推論、generic、nullability、effect、関数record合成
- `evaluation.md`／`evaluation_ja.md` — 評価順、制御フロー、error、cleanup
- `modules.md`／`modules_ja.md` — module、import、可視性、re-export、platform
- `entry-point.md`／`entry-point_ja.md` — `main`シグネチャと終了動作
- `tasks.md`／`tasks_ja.md` — 非同期実行と構造化並行処理
- `ffi.md`／`ffi_ja.md` — JavaScript境界
- `standard-library.md`／`standard-library_ja.md` — Bytes、固定幅整数、Unicode、collection
- `rules.json` — 仕様とテストの機械検査用対応表
