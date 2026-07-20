# VS Code対応

Viruneは、シンタックスハイライトとVirune Language Serverを同梱した自己完結型のVS Code拡張を提供します。

## インストール

GitHub Releasesから`virune-vscode-<version>.vsix`をダウンロードし、次を実行します。

```bash
code --install-extension virune-vscode-<version>.vsix
```

VS Codeのコマンドパレットから **Extensions: Install from VSIX...** を選択する方法でも導入できます。

Visual Studio Marketplaceでは配布しません。更新時は、GitHub Releasesから新しいVSIXをダウンロードして上書きインストールします。

## 含まれる言語機能

- `.virune`の言語登録
- シンタックスハイライトとSemantic Tokens
- 字句解析・構文解析・型・import・プロジェクト診断
- ドキュメントフォーマット
- Hover情報
- Document Symbols
- Go to Definition
- キーワード、宣言、import、引数、ローカル変数、フィールドの補完
- コンパイラ診断にfixが含まれる場合のQuick Fix変換

## 開発

```bash
npm ci
npm run test:vscode
npm run pack:vscode
```

生成された拡張は`release/virune-vscode-<version>.vsix`へ出力されます。

## Incremental analysis

serverはproject rootごとに1つの`IncrementalProjectBuilder`を保持します。overlay buffer textもsource hashへ含めるため、変更のないmoduleと実装変更の影響を受けない依存moduleは編集をまたいでcompiler stateを再利用します。
