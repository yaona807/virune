# Virune

Viruneは、読みやすいES2022 moduleへコンパイルする静的型付きアプリケーション言語です。
Node.jsとbrowserを対象とし、JavaScript／TypeScript連携を明示的かつ検証可能な境界として扱います。

現在のバージョン：**1.0.0**
最低Node.jsバージョン：**24**

[English](README.md)

## 設計目標

Viruneは次の4点を中心に設計します。

- 学習しやすいこと
- 構文が予測可能で読みやすいこと
- 自由度を意図的に狭くすること
- 高い静的型安全性と境界安全性を持つこと

言語核は少数の直交した基本機能に限定します。高度な振る舞いはprotocol、class、macro、暗黙implementation探索ではなく、関数、record、enum、generic、標準ライブラリの組み合わせで表現します。

## 主な特徴

- 名前的な`record`、`enum`、`newtype`
- 透過的な`type` alias
- `Option`、`Result`、postfix `?`
- 網羅的pattern matching
- デフォルトで不変なNative値
- `uses`による固定の組み込みeffect宣言
- `uses *`による非escape callbackのeffect転送
- `async`、`await`、`parallel`、`parallel try`による構造化並行処理
- `defer`による決定的cleanup
- 利用者が意味を変更できない構造的Eq／Hash
- 検証できない型を`Unknown`へ退避するJavaScript境界
- ESM出力、Source Map、Formatter、LSP、VS Code拡張、適合性試験、release tooling

Viruneはclass、継承、回復可能エラー用の例外、macro、operator overload、ユーザー定義protocol、ユーザー定義capability名、暗黙nullable、通常コードでのunchecked castを持ちません。

## サンプル

```virune
pub newtype UserId = Int

type UserLookup = fn(UserId) -> Result<User, UserError>

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

## リポジトリ構成

- `packages/compiler` — Lexer、Parser、Checker、project graph、Emitter、公開Compiler API
- `packages/runtime` — Runtime ABI v2とNative値操作
- `packages/stdlib` — Node.js／browser adapter
- `packages/formatter` — canonical formatter
- `packages/language-server` — LSP実装
- `packages/vscode` — syntax highlightingと同梱Language Server
- `packages/js-interop` — TypeScript Adapter検証
- `packages/cli` — project、binding、format、test、conformance command
- `spec` — 規範言語仕様
- `conformance` — 診断位置まで固定した適合性fixture
- `corpus` — JavaScript／TypeScript相互運用corpus

## Clone後の検証

```bash
npm ci
npm run verify
```

`npm run verify`はNode.js runtime、public package registry、release channel、Compiler API、TypeScript build、unit／integration、fuzz smoke、VS Code／LSP、conformance、formatter、規範仕様、grammar、clean cloneを検証します。

## CLI

```bash
npm run virune -- init path/to/project
npm run virune -- check path/to/project
npm run virune -- build path/to/project
npm run virune -- run path/to/project -- argument
npm run virune -- fmt path/to/project
npm run virune -- bind package-or-file.d.ts
```

## JavaScript／TypeScript連携

Virune moduleとJavaScript moduleのimportを区別します。

```virune
import { User } from "./user.virune"
import js { nanoid } from "nanoid"
import js axios from "axios"
import js * as fs from "node:fs/promises"
import js "./polyfill.js"
```

Safe FFIはRuntimeで完全に検証できる型だけを受け入れます。Callback、未解決generic、再帰aggregate、TypeScript `Record<K, V>`、object keyを持つidentity-sensitiveなMap／Setは`Unknown`へ退避するか、TypeScript Adapterを要求します。

詳細は[JavaScript連携](docs/js-interop_ja.md)と[規範仕様](spec/README_ja.md)を参照してください。

## リリース状態

Virune 1.0.0は最初のstable release targetです。公開されたstable APIと言語仕様にはSemantic Versioningを適用します。Runtime ABI v2とInterop ABI v2が1.0.0の正規ABIです。リリース条件は[docs/stable-release-gate_ja.md](docs/stable-release-gate_ja.md)に記載しています。

## License

MITです。[LICENSE](LICENSE)と[THIRD_PARTY_NOTICES_ja.md](THIRD_PARTY_NOTICES_ja.md)を参照してください。
