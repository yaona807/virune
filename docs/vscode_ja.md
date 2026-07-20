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
- 関数、推論型、record、enum、定義元を表示する詳細なHover情報
- 変数、関数戻り値、ループ変数、lambda引数の推論型を表示するInlay Hints
- 関数呼び出し時の設定可能な引数名Inlay Hints
- 現在の引数、戻り値、`uses` capabilityを表示するSignature Help
- Document Symbols
- Go to Definition
- キーワード、宣言、import、引数、ローカル変数、フィールドの補完
- コンパイラ診断にfixが含まれる場合のQuick Fix変換
- Hover、補完、Signature Helpへのドキュメントコメント表示
- `doc`／`moddoc` snippetと、本文がある`///`／`//!`行でEnterを押したときの自動継続
- **Virune: Generate Documentation Comment**および**Virune: Generate Module Documentation**コマンド

## エディタ情報の設定

型情報を中心としたエディタ表示はデフォルトで有効です。VS Codeの設定から次を変更できます。

```json
{
	"virune.inlayHints.variableTypes.enabled": true,
	"virune.inlayHints.functionReturnTypes.enabled": true,
	"virune.inlayHints.parameterNames": "literals",
	"virune.inlayHints.forLoopVariableTypes.enabled": true,
	"virune.inlayHints.lambdaParameterTypes.enabled": true,
	"virune.hover.showEffects": true,
	"virune.hover.showModule": true
}
```

`virune.inlayHints.parameterNames`には`none`、`literals`、`all`を指定できます。Inlay Hintsは表示上の注釈であり、Viruneソースファイル自体は変更しません。

## 開発

```bash
npm ci
npm run test:vscode
npm run pack:vscode
```

生成された拡張は`release/virune-vscode-<version>.vsix`へ出力されます。

## Incremental analysis

serverはproject rootごとに1つの`IncrementalProjectBuilder`を保持します。overlay buffer textもsource hashへ含めるため、変更のないmoduleと実装変更の影響を受けない依存moduleは編集をまたいでcompiler stateを再利用します。
