# Viruneでアプリケーションを構築する

[English](application-guide.md) | [日本語](application-guide_ja.md)

このガイドでは、空のプロジェクトから小さなViruneアプリケーションを構築するまでの実践的な流れを説明します。リポジトリ内の専用showcaseには依存せず、公開されているVirune 1.0の機能とCLIだけを使います。

> [!IMPORTANT]
> このガイドは説明用であり、規範仕様ではありません。Virune 1.0の厳密な動作は[`spec/`](../spec/README_ja.md)配下が定義します。このガイドと規範仕様が食い違う場合は、規範仕様を優先します。

## 1. 通常のプロジェクトから始める

公開CLIでプロジェクトを作成します。

```bash
virune init my-app
cd my-app
virune check .
virune run .
```

`virune init`は`virune.json`と`src/main.virune`を作成します。ソースディレクトリ、出力先、エントリーポイント、対象プラットフォームなどは、暗黙のビルド前提にせず`virune.json`へ明示します。

リポジトリには小さな実行例として[`examples/user-directory`](../examples/user-directory)もあります。これは参考用の例であり、このガイドの規範的な正本ではありません。

コマンドの正確な構文は[CLIリファレンス](cli-reference_ja.md)、実行可能なエントリーポイントの条件は[entry point仕様](../spec/entry-point_ja.md)を参照してください。

## 2. 基盤より先にドメインをモデル化する

アプリケーションの概念は、名前の付いた型と明示的なデータモデルで表します。

- 同じ表現でも交換可能にしたくない値には`newtype`を使う。
- 名前付きのドメインデータには`record`を使う。
- 閉じた選択肢やドメイン上の失敗には`enum`を使う。
- 値の不在には`Option<T>`または`T?`を使う。
- 関数の契約に含める失敗には`Result<T, E>`を使う。
- `Option`、`Result`、enumのvariantは`match`で明示的に扱う。

名前によって区別される型の生成や検証は、その型を所有するモジュールの近くに置きます。他モジュールから使いやすくするためだけに内部の生成処理を公開せず、必要な操作だけを狭い公開関数として提供します。

`List`、`Map`、`Set`などのコレクションも、I/Oではなくデータを表すのであればドメイン層に置けます。正確なAPIは[標準ライブラリガイド](standard-library_ja.md)を参照してください。

型と可視性の厳密な規則は[types](../spec/types_ja.md)、[evaluation](../spec/evaluation_ja.md)、[modules](../spec/modules_ja.md)を参照してください。[言語ガイド](language-guide_ja.md)には、検証済みの例を含むより広い入門があります。

## 3. エフェクトを依存境界へ置く

観測可能な処理は関数のシグネチャから見える状態を保ちます。たとえば、標準出力へ表示するコマンドラインのエントリーポイントは`uses Console`を宣言します。一方、上位層が結果を表示するだけなら、純粋なドメイン変換まで`Console`を取得する必要はありません。

実践上は次のように分けます。

1. 可能な限りドメイン変換を純粋に保つ。
2. モジュールや関数の境界では通常の型付きデータを受け渡す。
3. 実際に副作用を実行する関数だけが組み込みエフェクトを宣言する。
4. 上位層がI/Oを組み立て、下位層は狭い型付きの契約を公開する。

この構成のためにVirune専用のDIフレームワークは必要ありません。重要なのは、依存関係やエフェクトを暗黙のグローバル状態へ隠さないことです。

エフェクトと呼び出し互換性の厳密な規則は[types](../spec/types_ja.md)と[evaluation](../spec/evaluation_ja.md)を参照してください。

## 4. 非同期処理とクリーンアップを構造化する

Viruneに構造化された機能がある場合、切り離されたJavaScript Promiseや場当たり的なクリーンアップへ置き換えません。

- `async fn`で非同期処理を宣言する。
- `parallel`と`parallel try`で子処理を構造化されたグループとして扱う。
- `await`でタスク結果を待つ。
- postfix `?`で`Result`の失敗を伝播する。
- `defer`でレキシカルスコープへ決定的なクリーンアップを紐付ける。

重要なのは所有関係です。子処理は、それを作成した構造化された処理へ紐付き、クリーンアップは登録したスコープへ紐付きます。

タスク、キャンセル、構造化並行処理の厳密な意味論は[tasks](../spec/tasks_ja.md)、クリーンアップと評価順序は[evaluation](../spec/evaluation_ja.md)を参照してください。

## 5. JavaScript相互運用では最も狭い境界を選ぶ

実装が簡単になるという理由だけで、より弱い境界へAPIを移しません。外部との契約を正確に表現できる最も狭い境界から始めます。

### Generated binding

TypeScript型宣言を保守的に表現できる場合は`virune bind`を使います。

```bash
virune bind ./types/example.d.ts \
  --module example-package \
  --out src/ffi/example.virune
```

未対応または安全に表現できないTypeScriptの型は、診断を伴って`Unknown`として残ります。生成バインディングはレビュー可能なソースであり、生成されたという理由だけで自動的に信頼済みになるわけではありません。

### TypeScript adapter

JavaScript／TypeScript APIをVirune Interop ABIへ渡す前に形を変換する必要がある場合は、`*.interop.ts`アダプターを使います。

```bash
virune interop init example-package
virune interop check .
```

アダプターは狭く明示的に保ちます。依存パッケージのAPI全体を複製するのではなく、Viruneが実際に利用する境界だけを公開します。

### Isolated unsafe FFI

安全な経路では安全性の契約を表現できず、その境界を明示的に監査した場合だけ`unsafe extern`を使用します。生の`unsafe extern`はプロジェクトの`ffi/`境界配下にある`unsafe module`へ置きます。通常のアプリケーションコードからは、レビュー済みの窓口だけを呼び出します。

実践的な考え方は[JavaScript／TypeScript連携](js-interop_ja.md)を参照してください。厳密な境界規則は規範の[JavaScript FFI](../spec/ffi_ja.md)と[JavaScript interop仕様](../spec/js-interop_ja.md)が定義します。

## 6. Node.jsとbrowserの対象を明示する

互換性のないプラットフォーム固有の前提を1つのプロジェクト設定へ隠しません。Node.jsとbrowserでエントリーポイントが異なるアプリケーションでは、適切な`platform`を指定した別のプロジェクトルートまたは別設定として分けます。

プラットフォーム固有の依存は対応する境界の内側に置きます。共有モジュールからNode-onlyまたはbrowser-onlyの動作へ暗黙に依存しないようにします。

JavaScriptからVirune関数を直接呼び出す必要がある場合は、生成された実装詳細へ依存せず、サポートされた`@jsExport`境界を使います。

プラットフォームとモジュールの厳密な規則は[modules](../spec/modules_ja.md)、JavaScript exportの規則は[JavaScript FFI](../spec/ffi_ja.md)、実行可能なentryの規則は[entry points](../spec/entry-point_ja.md)を参照してください。

## 7. 再現可能な検証手順を使う

リポジトリ専用のshowcase gateへ依存せず、公開CLIをプロジェクトに対して実行します。

```bash
virune fmt --check .
virune check .
virune test .
virune build .
virune run .
```

Virune APIを公開するプロジェクトでは、最初に決定的なスナップショットを作成し、その後の検証で同じスナップショットを確認します。

```bash
virune api . --out virune.api.json
virune api . --out virune.api.json --check
```

TypeScriptアダプターを含む場合は、次も実行します。

```bash
virune interop check .
```

リポジトリへ保存したバインディングの元になるTypeScript型宣言や依存関係を変更した場合は、バインディングを再生成し、その差分をレビューします。CIでも、開発者がローカルで再現できる同じ公開コマンドを使うことを基本とします。

コマンドの正確な構文は[CLIリファレンス](cli-reference_ja.md)を参照してください。

## 規範仕様とこのガイドの責務

| 確認したいこと | 参照先 |
|---|---|
| 通常のアプリケーションをどう構成するか | このガイド |
| 正確な型／エフェクト規則は何か | [`spec/types.md`](../spec/types_ja.md) |
| 正確な評価／クリーンアップ規則は何か | [`spec/evaluation.md`](../spec/evaluation_ja.md) |
| 正確な非同期／タスク規則は何か | [`spec/tasks.md`](../spec/tasks_ja.md) |
| JavaScript境界で何が許可されるか | [`spec/ffi.md`](../spec/ffi_ja.md)と[`spec/js-interop.md`](../spec/js-interop_ja.md) |
| モジュール／プラットフォームを越えて何が許可されるか | [`spec/modules.md`](../spec/modules_ja.md) |
| 有効な実行可能エントリーポイントとは何か | [`spec/entry-point.md`](../spec/entry-point_ja.md) |
| CLIの正確な構文は何か | [CLIリファレンス](cli-reference_ja.md) |

アプリケーション構成を選ぶときはこのガイドを使い、厳密な動作を確定するときは規範仕様を使います。

## 次に読むもの

- 小さな実行可能アプリケーションは[`examples/user-directory`](../examples/user-directory)を参照する。
- より広い構文と意味論の入門は[言語ガイド](language-guide_ja.md)を参照する。
- 外部境界を設計するときは[JavaScript／TypeScript連携](js-interop_ja.md)を参照する。
- コマンドの動作やオプションは[CLIリファレンス](cli-reference_ja.md)を参照する。
- 互換性や正しさの判断に厳密なVirune 1.0の動作が必要な場合は[規範仕様一覧](../spec/README_ja.md)を参照する。
