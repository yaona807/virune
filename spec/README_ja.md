# Virune 1.0 規範仕様

[英語版](README.md)

このREADMEは、Virune 1.0の規範仕様を案内する索引です。このディレクトリにある、安定した規則IDを宣言する英語・日本語の対訳文書と`grammar.ebnf`が、Virune 1.0の規範的な契約を定めます。以下の一覧は文書への案内であり、対象文書を手作業で指定する許可リストではありません。ほかの解説文書と矛盾した場合は、こちらの仕様を優先します。Runtime ABIの詳細については、[Runtime ABI v2](runtime-abi_ja.md)を規範とします。

外部から観測できる規則には、`[type.nominal-identity]`のような安定したIDを付けています。`npm run spec:check`は、英日一対の規範文書から規則IDを検出し、適合試験の期待値や、リポジトリ内のテスト・検証器に付けた注記で宣言された実行可能な検証根拠に対応付けます。言語の動作を変えない文章上の修正は可能ですが、Virune 1.0以降の動作を変更する場合は[互換性方針](../COMPATIBILITY_ja.md)に従います。

## 文書

- `grammar.ebnf` — 完全な規範文法と改行正規化の契約
- [字句構造](lexical_ja.md) — ソースの文字コード、トークン、コメント、文の終端
- [ドキュメントコメント](documentation_ja.md) — ドキュメントコメントの関連付け、Markdown、診断
- [型](types_ja.md) — 型同一性、推論、ジェネリクス、null許容性、ケイパビリティ
- [評価と制御フロー](evaluation_ja.md) — 評価順、制御フロー、エラー、後始末
- [モジュールとパッケージ](modules_ja.md) — モジュール、インポート、可視性、再エクスポート、対象プラットフォーム
- [フロントエンドのコンポーネントとViewの記述](frontend_ja.md) — フレームワーク非依存のコンポーネント境界、型名を持たないView構造、子要素、宣言的な条件分岐
- [実行エントリーポイント](entry-point_ja.md) — 実行可能な`main`のシグネチャと終了動作
- [タスクと構造化並行処理](tasks_ja.md) — 非同期実行と構造化並行処理
- [JavaScript FFI](ffi_ja.md) — JavaScriptとの境界に関する規則
- [JavaScript相互運用モデル](js-interop_ja.md) — 規範的なJavaScript / TypeScript相互運用契約
- [JavaScript相互運用における第三者パッケージの配布境界](js-interop-distribution_ja.md) — 宣言ファイルの解析、再配布、外部パッケージのライセンス、バンドルの境界
- [標準型と標準ライブラリ](standard-library_ja.md) — `Bytes`、固定幅整数、Unicode、コレクションの意味論
- [Runtime ABI v2](runtime-abi_ja.md) — 生成コードとRuntimeの間のRuntime ABI v2契約