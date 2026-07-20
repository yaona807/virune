<p align="center">
  <img src="assets/virune-logo.svg" alt="Virune" width="520">
</p>

<h1 align="center">Virune</h1>

<p align="center">
  JavaScriptエコシステムのための静的型付きプログラミング言語。<br>
  読みやすいES2022モジュールへコンパイルし、値の不在、エラー、副作用、並行処理、JavaScript境界を明示します。
</p>

<p align="center">
  <a href="https://github.com/yaona807/virune/actions/workflows/ci.yml"><img src="https://github.com/yaona807/virune/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI"></a>
  <img src="https://img.shields.io/badge/version-1.0.0-5A54E8" alt="Version 1.0.0">
  <img src="https://img.shields.io/badge/Node.js-%3E%3D24-339933?logo=nodedotjs&logoColor=white" alt="Node.js 24以上">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT License"></a>
</p>

<p align="center">
  <a href="#クイックスタート">クイックスタート</a> ·
  <a href="docs/language-guide_ja.md">言語ガイド</a> ·
  <a href="docs/cli-reference_ja.md">CLIリファレンス</a> ·
  <a href="docs/vscode_ja.md">VS Code</a> ·
  <a href="spec/README_ja.md">言語仕様</a> ·
  <a href="README.md">English</a>
</p>

> [!IMPORTANT]
> **リリース状況:** Virune 1.0.0のソース一式は準備済みですが、最初のGitHub Releaseとnpm公開はまだ実施していません。現時点では、以下の手順でソースから利用してください。VS Code拡張はVisual Studio MarketplaceではなくVSIXで配布します。

## Viruneが解決する課題

JavaScriptには成熟した実行環境と巨大なパッケージエコシステムがあり、TypeScriptは開発時の多くの誤りを検出できます。一方、TypeScriptの型は実行時には存在しないため、外部データやJavaScriptパッケージとの境界では、別途検証を設計する必要があります。

より強い安全性を持つ言語の多くは、独自のRuntime、パッケージマネージャー、配布方式を伴います。Viruneは対象を絞り、Node.js、browser、ESM、npmのエコシステムを維持しながら、アプリケーション開発で問題になりやすい要素を、明示的な言語機能と検証可能な境界へ移します。

Viruneの設計原則は次の4点です。

- **標準で読みやすい** — 予測可能な構文と、決定的で確認しやすいES2022出力。
- **失敗を明示する** — `Option`、`Result`、`Validation`、網羅的matchを使用し、暗黙のnullable値を持たない。
- **副作用を制御する** — 関数は`uses`で組み込みeffectを宣言し、リソースは`defer`で確実に解放する。
- **相互運用を保守的に扱う** — JavaScript／TypeScript境界を検証し、対応できない型を推測せず`Unknown`へ退避する。

## Viruneの主要機能

| 課題 | Viruneの扱い |
|---|---|
| 値の不在 | 暗黙の`null`／`undefined`ではなく`Option<T>` |
| 回復可能なエラー | `Result<T, E>`、`Validation<T, E>`、postfix `?`による伝播 |
| データモデル | 名前的な`record`、`enum`、`newtype`と、透過的な`type` alias |
| 制御構文 | guardを含む網羅的pattern matchingと構造化されたloop |
| 副作用 | `uses`による固定の組み込みeffect宣言と、`uses *`による高階関数への転送 |
| 並行処理 | 構造化された`async`、`await`、`parallel`、`parallel try` |
| リソース寿命 | `defer`による決定的なLIFO cleanup |
| JavaScript連携 | 明示的な`import js`、Runtime検証、TypeScript binding生成、Adapter |
| ツールチェーン | CLI、Formatter、Source Map、LSP、VS Code拡張、適合性試験、Fuzz、リリース検証 |

Viruneは意図的に、class、継承、macro、operator overload、ユーザー定義protocol、ユーザー定義capability名、暗黙nullable、通常コードでのunchecked cast、独自VM、独自パッケージマネージャーを持ちません。

## 言語例

```virune
pub newtype UserId = Int

pub record User derives Eq, Hash, Debug, Json {
	id: UserId
	name: String
	nickname: String?
}

pub enum UserError derives Eq, Debug, Json {
	NotFound(UserId)
	InvalidName(String)
}

fn display(user: User) -> String {
	let nickname = match user.nickname {
		Some(value) => value
		None => "未設定"
	}
	return "{user.name} ({nickname})"
}

pub fn main(args: List<String>) -> Result<Unit, UserError> uses Console {
	let user = User {
		id: UserId.create(1)
		name: "Alice"
		nickname: None
	}
	Console.print(display(user))
	Console.print("引数の数: {List.length(args)}")
	return Ok(Unit)
}
```

## クイックスタート

### 必要環境

- Node.js 24以上
- Node.jsに同梱されるnpm
- Git

### ソースからビルドして実行する

```bash
git clone https://github.com/yaona807/virune.git
cd virune
npm run bootstrap
npm run build
npm run virune -- --version
npm run example
```

次の出力が含まれます。

```text
virune 1.0.0
Hello from Virune
```

`npm run bootstrap`は、lockfileに固定された依存関係を公開npmレジストリからインストールします。レジストリ設定や環境構築の詳細は[クローン後の導入手順](docs/getting-started-from-clone_ja.md)を参照してください。

### プロジェクトを作成する

```bash
npm run virune -- init playground/hello
npm run virune -- check playground/hello
npm run virune -- build playground/hello
npm run virune -- run playground/hello
```

プログラム引数は`--`の後ろへ指定します。

```bash
npm run virune -- run examples/user-directory -- Alice Bob
```

## JavaScript／TypeScript連携

Virune moduleとJavaScript moduleは、import構文の時点で明確に区別します。

```virune
import { User } from "./user.virune"
import js { nanoid } from "nanoid"
import js axios from "axios"
import js * as fs from "node:fs/promises"
import js "./polyfill.js"
```

Safe FFIが受け入れるのは、Runtimeで完全に検証できる値だけです。対応していないcallback、未解決generic、再帰aggregate、TypeScriptの`Record<K, V>`、objectをkeyに持つidentity-sensitiveなMap／Setは、`Unknown`へ退避するかTypeScript Adapterを要求します。

詳細は[JavaScript／TypeScript連携](docs/js-interop_ja.md)、[binding対応範囲](docs/ffi-coverage_ja.md)、[規範FFI仕様](spec/js-interop_ja.md)を参照してください。

## VS Code対応

リポジトリから拡張機能を生成し、直接インストールできます。

```bash
npm run pack:vscode
code --install-extension release/virune-vscode-1.0.0.vsix
```

拡張機能には、構文・Semantic Highlight、診断、Formatter、Hover、Document Symbol、補完、定義ジャンプ、Quick Fix、Virune Language Serverが含まれます。詳細は[VS Code対応](docs/vscode_ja.md)を参照してください。

## ドキュメント

| ドキュメント | 内容 |
|---|---|
| [導入手順](docs/getting-started-from-clone_ja.md) | Clone、install、build、run、トラブルシューティング |
| [言語ガイド](docs/language-guide_ja.md) | Viruneの構文と意味論の実用的な解説 |
| [CLIリファレンス](docs/cli-reference_ja.md) | Command、option、終了動作 |
| [標準ライブラリ](docs/standard-library_ja.md) | Node.js／browser adapter |
| [VS Code対応](docs/vscode_ja.md) | 拡張機能の導入方法と提供機能 |
| [JavaScript連携](docs/js-interop_ja.md) | FFI、binding生成、Adapter |
| [Compiler API](docs/compiler-api_ja.md) | Stable APIとexperimental API |
| [Runtime ABI v2](docs/runtime-abi_ja.md) | 生成コードとRuntime間の契約 |
| [規範言語仕様](spec/README_ja.md) | Virune 1.0の厳密な動作 |

英語版ドキュメントには`_ja.md`のないファイル名を使用します。

## 開発と検証

ローカルの品質ゲートをすべて実行します。

```bash
npm run verify
```

このコマンドは、Node.js baseline、レジストリ設定、release channel、Compiler API互換性、TypeScript build、unit／integration test、binding corpus、fuzz smoke、VS Code／LSP、conformance fixture、Formatter、規範仕様の網羅性、grammar、clean clone、release package、clean install後の実行を検証します。

ローカルのリリース成果物は次のコマンドで生成します。

```bash
npm run pack:virune
npm run pack:vscode
```

npm tarball、VSIX、SHA-256 manifestなどの成果物は`release/`へ出力されます。

## リポジトリ構成

| Path | 内容 |
|---|---|
| `packages/compiler` | Lexer、Parser、Checker、project graph、Emitter、Evaluator、公開Compiler API |
| `packages/runtime` | Runtime ABI v2とNative値操作 |
| `packages/stdlib` | Node.js／browser adapter |
| `packages/formatter` | Canonical Formatter |
| `packages/language-server` | Language Server Protocol実装 |
| `packages/vscode` | Syntax定義、extension client、同梱server |
| `packages/js-interop` | TypeScriptベースのbinding・Adapter検証 |
| `packages/cli` | Project、build、run、format、test、binding、conformance command |
| `spec` | Virune 1.0の規範言語仕様 |
| `conformance` | 受理・拒否するコードと厳密な診断結果 |
| `corpus` | JavaScript／TypeScript相互運用corpus |
| `fuzz-regressions` | 再現可能なcrash・regression入力 |

## 安定性と互換性

Viruneは、公開済みのstable APIと規範言語仕様にSemantic Versioningを適用します。Virune 1.0ではRuntime ABI v2とInterop ABI v2を正規ABIとします。Compiler内部APIと明示的なexperimental APIはstable互換性保証の対象外です。

詳細は[release channel](docs/release-channels_ja.md)、[Compiler APIの互換性方針](docs/compiler-api_ja.md)、[stable release gate](docs/stable-release-gate_ja.md)を参照してください。

## コントリビューション

不具合報告、ドキュメント修正、相互運用の検証ケース、対象を絞ったPull Requestは[GitHub Issues](https://github.com/yaona807/virune/issues)から受け付けます。

言語機能を変更する場合は、実装前にIssueを作成してください。構文、意味論、互換性への影響、仕様更新、適合性試験をまとめて確認します。Pull Requestでは英語版と日本語版のドキュメントを同期し、`npm run verify`を通してください。

Viruneは現在、[Yaona](https://github.com/yaona807)がメンテナンスしています。

## セキュリティと保証範囲

Viruneはセキュリティサンドボックスではありません。JavaScript実行と`unsafe`な相互運用は、Viruneの静的安全保証の対象外です。また、現時点では独立したセキュリティ監査を受けていません。

## ライセンス

Viruneは[MIT License](LICENSE)で提供します。第三者ライセンスは[THIRD_PARTY_NOTICES_ja.md](THIRD_PARTY_NOTICES_ja.md)を参照してください。
