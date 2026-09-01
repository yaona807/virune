# Virune 1.0 規範仕様

[英語版](README.md)

このREADMEはVirune 1.0規範仕様の索引です。このディレクトリ内で安定した規則IDを宣言する英日対の文書と`grammar.ebnf`が、Virune 1.0の規範的な契約を定めます。以下の文書一覧は索引であり、手動の許可リストではありません。ほかの解説文書と内容が矛盾する場合は、これらの仕様を優先します。Runtime ABIの詳細は[Runtime ABI v2](runtime-abi_ja.md)が規範です。

外部から観測できる各規則には、`[type.nominal-identity]`のような安定IDがあります。`npm run spec:check`は、英日で対になった規範文書から規則IDを検出し、適合試験の期待値またはリポジトリ管理下のテスト・検証器に付けた注記で宣言された実行可能Evidenceへ接続します。言語の挙動を変えない編集上の修正はできますが、Virune 1.0以降の振る舞いを変える場合は[互換性方針](../COMPATIBILITY_ja.md)に従います。

## 文書

- `grammar.ebnf` — 完全な規範文法と改行正規化の契約
- [字句構造](lexical_ja.md) — ソースの文字コード、トークン、コメント、文の終端
- [ドキュメントコメント](documentation_ja.md) — ドキュメントコメントの関連付け、Markdown、診断
- [型](types_ja.md) — 型同一性、推論、ジェネリクス、null許容性、ケイパビリティ
- [評価と制御フロー](evaluation_ja.md) — 評価順、制御フロー、エラー、後始末
- [モジュールとパッケージ](modules_ja.md) — モジュール、インポート、可視性、再エクスポート、対象プラットフォーム
- [実行エントリーポイント](entry-point_ja.md) — 実行可能な`main`のシグネチャと終了動作
- [タスクと構造化並行処理](tasks_ja.md) — 非同期実行と構造化並行処理
- [JavaScript FFI](ffi_ja.md) — JavaScriptとの境界に関する規則
- [JavaScript相互運用モデル](js-interop_ja.md) — 規範的なJavaScript / TypeScript相互運用契約
- [JavaScript相互運用における第三者パッケージの配布境界](js-interop-distribution_ja.md) — 宣言ファイルの解析、再配布、外部パッケージのライセンス、バンドルの境界
- [標準型と標準ライブラリ](standard-library_ja.md) — `Bytes`、固定幅整数、Unicode、コレクションの意味論
- [Runtime ABI v2](runtime-abi_ja.md) — 生成コードとRuntimeの間のRuntime ABI v2契約
