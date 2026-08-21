# Viruneへのコントリビューション

English: [CONTRIBUTING.md](CONTRIBUTING.md)

この文書は、Viruneそのものを変更する開発者向けの入口です。初めてリポジトリを触る場合でも、環境構築からPull Requestまでここから辿れるようにしています。

## 1. 変更を始める前に

コミュニティ上の行動は[行動規範](CODE_OF_CONDUCT_ja.md)に従ってください。セキュリティ上の問題は公開Issueへ書かず、[セキュリティポリシー](SECURITY_ja.md)に従って報告してください。

小さな誤字修正や明らかなバグ修正は、Issueを作らずPull Requestを送って構いません。次の変更は、実装前にIssueで目的、範囲、互換性や安全性への影響を確認してください。

- 大きな機能追加や設計変更
- 言語仕様の変更
- 公開Compiler APIの変更
- Runtime ABIやInterop ABIの変更
- 互換性方針に影響する変更
- リリースやCIの安全境界を変える変更

迷う場合は、実装を大きく進める前にIssueを作成してください。

## 2. 開発環境を用意する

必要なNode.jsのバージョンはルート`package.json`の`engines`を正本とします。npmはそのNode.jsに対応するものを使用します。

```bash
git clone https://github.com/yaona807/virune.git
cd virune
npm run bootstrap
npm run build
```

`npm run bootstrap`は、公開npm Registryを明示して`npm ci`を実行し、lockfileどおりに開発用依存関係を準備します。独自の導入手順を追加する前に、まずこのコマンドを使ってください。

最低限の動作確認として、次を実行できます。

```bash
npm run virune -- --version
npm run test:core
```

コマンドが分からない場合は、古い文書や過去のPull Requestではなく、現在の`package.json`の`scripts`を確認してください。

## 3. どこを変更するか

主な場所は次のとおりです。

| パス | 主な責務 |
|---|---|
| `packages/compiler` | Lexer、Parser、型検査、プロジェクト処理、コード生成、Compiler API |
| `packages/runtime` | 生成コードが利用するRuntimeと公開ABI |
| `packages/stdlib` | 標準ライブラリ |
| `packages/formatter` | Formatter |
| `packages/js-interop` | JavaScript／TypeScript連携、binding、Adapter検証 |
| `packages/cli` | `virune` CLI |
| `packages/language-server` | Language Server |
| `packages/vscode` | VS Code拡張 |
| `spec` | 規範的な言語仕様とRuntime ABI |
| `conformance` | 言語仕様への適合を確認するテストデータ |
| `integration` | コンポーネントをまたぐ統合テスト |
| `selfhost` | Viruneで実装したセルフホスト用コンパイラー |
| `.github` | CI、リリース、Self-hostingの機械可読ポリシーとGitHub Actions workflow |
| `scripts` | ビルド、検証、CI、リリースで使うリポジトリ管理処理 |

同じ意味を別の場所へ複製しないでください。現在の挙動はコードとテスト、規範的な契約は`spec/`、機械判定はJSONやworkflow、個別の実装計画はIssueとPull Requestを正本とします。

### Compilerの流れ

Compiler全体を変更するときは、まず処理がどの段階に属するかを確認します。大まかな流れは次のとおりです。

```text
ソースコード
  ↓
Lexer / Parser
  ↓
AST
  ↓
project / module graph
  ↓
宣言の収集・名前解決
  ↓
型 / effect / control-flow / FFI検査
  ↓
HIR / MIR lowering
  ↓
ES2022 / Source Map出力
```

LexerとParserは構文とソース位置を扱い、Checkerは型、effect、制御フローなどの意味を検査します。loweringとコード生成は、検査済みの結果をRuntime ABIやInterop ABIに従う出力へ変換します。

Stable Compiler APIから内部AST、HIR、MIR、arena、semantic tableを直接公開しないという境界も維持してください。

## 4. 変更の進め方

通常は次の順序で進めます。

1. 対象Issue、関連Pull Request、最新の`main`を確認する。
2. 最新の`main`から作業ブランチを作る。
3. 1つの目的に絞って実装する。
4. 変更箇所に近いテストを実行する。
5. 動作を変えた場合は回帰テストを追加または更新する。
6. 必要なら言語仕様、API／ABIのスナップショット、機械可読ポリシーを同じ変更で更新する。
7. 変更全体を検証する。
8. Draft Pull Requestを作り、差分と検証結果を確認する。
9. CIとレビューで見つかった問題を修正し、修正後のheadで改めて確認する。

関係のない整形、命名変更、リファクタリングを同じPull Requestへ混ぜないでください。

通常の修正ではコミットを追加して履歴を進めます。`main`が進んだだけ、あるいは作業途中のコミットをまとめたいだけの理由でforce-pushしません。親Pull Requestのsquash後など、履歴が実際に複雑になり通常のrebaseやmergeでは安全に整理できない場合だけ、最新`main`からの再構成を検討します。

## 5. テストを選ぶ

最初は変更箇所に近い検証を行い、その後に必要な全体検証へ広げます。正確なコマンド一覧は`package.json`を正本とします。

代表的な入口は次のとおりです。

| 変更 | 主な確認 |
|---|---|
| TypeScriptの型・ビルド | `npm run check` |
| CompilerやRuntimeの一般的な変更 | `npm run test:core` |
| 規範仕様 | `npm run spec:check` |
| Stable Compiler API | `npm run api:check` |
| 公開ABI | `npm run abi:check` |
| リポジトリ全体 | `npm run verify` |

この表にない領域では、`package.json`と対象コードに近い既存テストを先に探してください。テストを通すためだけの新しい例外経路や、特定のテストデータだけを通す処理を追加してはいけません。

バグ修正では、可能な限り修正前に失敗し修正後に成功する回帰テストを追加します。正常系だけでなく、必要に応じて不正入力、欠落、重複、古い状態、境界値、途中失敗、cleanup、決定性も確認してください。

## 6. 言語仕様を変更する場合

Viruneの言語として正しい動作は[`spec/`](spec/README_ja.md)が正本です。

ParserやCheckerの実装だけを変更して仕様を後追いにしないでください。仕様変更が必要な場合は、Issueで変更理由と互換性を確認し、対応する仕様、実装、テストを同じPull Requestで揃えます。

仕様、実装、テストが食い違っている場合は、都合のよいものを正しいと推測しないでください。どれが正本かを確認し、矛盾を解消してから進めます。

## 7. 公開APIとABIを変更する場合

Stable Compiler APIの機械的な正本は`packages/compiler/api/stable-api.snapshot.json`と公開エントリーポイントです。確認には`npm run api:check`を使用します。

Runtime、Interop、標準ライブラリを含む公開ABIは`packages/public-abi.snapshot.json`と[`spec/runtime-abi_ja.md`](spec/runtime-abi_ja.md)を確認し、`npm run abi:check`で検証します。

スナップショットを更新しただけでは、非互換変更を許可したことにはなりません。Stableな契約を壊す変更は[`COMPATIBILITY_ja.md`](COMPATIBILITY_ja.md)に従って判断してください。

## 8. Self-hostingを変更する場合

Self-hostingの都合だけでVirune言語、Compiler API、Runtime ABI、Interop ABI、公開標準ライブラリを変更してはいけません。

Self-hostingでViruneへ移すのは、**外部環境に依存せず、入力と出力を明示的なデータとして扱える決定的なCompiler Kernel**に限ります。環境依存処理や全体の処理手順を組み立てる役割はJavaScript／TypeScript Hostへ残します。

Hostへ残す主な責務は次のとおりです。

- CLIとプロセスのライフサイクル
- ファイルシステム、パス解決、環境変数、暗号学的ハッシュ
- ソースファイルの探索と読み込み
- TypeScript宣言とJavaScript bindingの解析
- VS CodeやLanguage Serverの通信層
- パッケージ作成、リリース、attestation（証明）
- bootstrap処理の編成とロールバックの選択

HostとKernelの境界は、バージョン付きで検証可能な、データだけで表現できる契約にします。callback、任意のJavaScript関数、class instance、TypeScript AST node、ファイルハンドルなど、オブジェクトの同一性や実行環境に依存する値をKernelとの契約へ持ち込まないでください。

まず既存の言語機能、内部アルゴリズム、データ契約で解決できないかを検討し、それでも不適切ならHost側へ責務を残します。Self-hostingだけのために新しい構文や公開APIを追加しません。

Self-hostingの現在状態、昇格条件、seed、corpusなどの正確な値は`.github/self-hosting/`のJSON、`selfhost/`、既存のスクリプトとテストを正本とします。Production Compilerへの昇格は、これらの機械可読ポリシーが要求する検証を同じ候補コミットで満たした場合だけ行います。

Self-hosting向けの検証コマンドは`package.json`の`selfhost:*`から、変更した境界に対応する既存コマンドを選んでください。必要な検証を省くために専用の近道を作らないでください。

## 9. CIが失敗した場合

CIの成功結果は、その結果が実行された**正確なコミット**に対する証拠です。headを変更した後に、古いheadの成功結果を現在の変更の証拠として使わないでください。

失敗はまず原因を分類します。

- **実装またはリポジトリの問題**: 原因を修正し、新しいheadで検証する。
- **GitHub Actions、runner、外部Action取得などの基盤障害**: コードが原因でないことを確認できた場合だけ、同じheadの再実行を検討する。
- **原因不明**: 推測で再実行せず、ログと失敗箇所を調べる。

同じheadを成功するまで繰り返し再実行する運用はしません。繰り返し必要になる診断は、一時workflowではなくリポジトリ内の既存コマンドや恒久的な検証へ組み込みます。

## 10. リリースに関わる変更

通常のCIが成功したことだけでは、安定版リリースを許可しません。

リリースの正確な条件は`.github/stable-release-gate.json`、`.github/release/`、リリース用workflow、検証スクリプトを正本とします。公開する成果物は、レビューした成果物の名前、内容、ハッシュ、対象コミットなどの識別情報と一致していなければなりません。

既存の公開成果物を通常経路で上書きしないでください。復旧が必要な場合も、公開済みの状態を改めて確認し、正しく公開済みのものを再公開せず、不明な状態を安全とみなさないことが原則です。

## 11. 文書を変更する場合

このリポジトリのMarkdownは必要最小限に保ちます。新しい恒久文書は、原則として次のすべてを満たす場合だけ追加します。

1. コード、テスト、スキーマ、workflowから安全に復元できない。
2. 特定のIssueやPull Requestだけに必要な一時的な説明ではなく、長期間使う契約である。
3. 既存の文書へ自然に置けない。
4. 維持費を払っても独立させる価値がある。

日本語と英語を対にする文書では、**まず日本語版を完成させます**。不自然な日本語、不要な英語混じり、曖昧な言い回しを取り除いた後、その意味を基準に英語版を作成します。英語版を先に作り、日本語を直訳する進め方はしません。

同じルールを複数文書へ転載せず、正本への相対リンクを使ってください。

## 12. Pull Requestとレビュー

Pull Requestは1つの論理的な変更に絞ります。関連Issue、変更範囲、意図的に変更していない境界、実行した検証を本文に記載してください。作業中や検証前はDraftのままにします。

設計、実装、Pull Requestの準備、merge判断では、変更を擁護するのではなく壊す観点でレビューします。

1. 要件、Acceptance Criteria、守るべき契約を確認する。
2. 現在の差分全体を確認する。
3. 修正すべき問題があれば直す。
4. 必要な検証を実行する。
5. 修正後の差分を最初から見直す。
6. 新しい修正事項が0件になるまで繰り返す。

CIが成功したことや、何度レビューしたかは終了条件ではありません。

merge前には、少なくとも現在のhead、正式なCI、最終差分、未解決のreview thread、Acceptance Criteria、残ったTODOや一時経路を確認します。headが変わった場合は、必要なCIと最終レビューをやり直してください。

日本語文書を含むPull Requestは、最終headの日本語diffをメンテナーが確認して明示的に承認するまでmergeしません。承認後にheadが変わった場合は、再度確認が必要です。

原則としてsquash mergeを使用します。

## 13. ライセンス

Viruneは[Apache License 2.0](LICENSE)で公開されています。

Viruneへ取り込む目的で提出したコードや文章は、別途明示しない限りApache License 2.0の条件で提供されるものとして扱います。第三者のコード、文章、画像などを含める場合は、その利用権限と必要な表示を確認してください。
