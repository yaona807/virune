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
- Document Symbols、Outline、Breadcrumbs
- Go to Declaration、Go to Definition、Peek Definition、Go to Type Definition
- ワークスペース全体のFind All Referencesとドキュメント内ハイライト
- 呼び出し元・呼び出し先のCall Hierarchy
- import aliasを考慮した安全なワークスペースRename
- Workspace Symbols検索
- top-level宣言への参照数・呼び出し元数CodeLens
- キーワード、宣言、import、引数、ローカル変数、フィールドの補完
- publicなViruneシンボルのAuto Import補完
- **Organize Imports** source action
- interop宣言情報を利用したJavaScript／TypeScript定義ジャンプ
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
	"virune.hover.showModule": true,
	"virune.codeLens.references.enabled": true,
	"virune.codeLens.callers.enabled": true,
	"virune.codeLens.visibility": "public"
}
```

`virune.inlayHints.parameterNames`には`none`、`literals`、`all`を指定できます。`virune.codeLens.visibility`には`public`または`all`を指定できます。Inlay HintsとCodeLensは表示上の注釈であり、Viruneソースファイル自体は変更しません。

## Semantic Navigation

Language Serverは、project root配下にあるすべての`.virune`ソースからプロジェクト横断のSemantic Indexを構築します。Indexには、正規化された宣言ID、import alias、re-export、参照種別、呼び出し関係、型定義リンクを保持します。未保存のeditor bufferを最新状態として扱います。

import aliasに対するRenameは、そのaliasが存在するファイル内だけを変更します。元の宣言をRenameした場合はワークスペース全体の正規参照を変更し、明示的なalias名は維持します。JavaScript／TypeScript importはVirune側からRenameしませんが、interop providerが宣言パスを返す場合は定義元ソースへ移動できます。

## 開発

```bash
npm ci
npm run test:vscode
npm run pack:vscode
```

生成された拡張は`release/virune-vscode-<version>.vsix`へ出力されます。

## Incremental analysis

serverはproject rootごとに1つの`IncrementalProjectBuilder`を保持します。overlay buffer textもsource hashへ含めるため、変更のないmoduleと実装変更の影響を受けない依存moduleは編集をまたいでcompiler stateを再利用します。すべての`.virune`ファイルをeditor analysisのentryへ含めることで、Workspace SymbolsとAuto Importの網羅性を保ちながらcompiler-levelの再利用を維持します。
