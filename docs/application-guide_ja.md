# Viruneでアプリケーションを構築する

[English](application-guide.md) | [日本語](application-guide_ja.md)

このガイドは、空のプロジェクトから小さなViruneアプリケーションを構築するまでの実践的な流れを説明します。repository-ownedのshowcaseアプリケーションを前提にせず、公開されているVirune 1.0の機能とCLIだけで構成します。

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

`virune init`は`virune.json`と`src/main.virune`を作成します。source directory、output directory、entry point、target platformなどの設定は、暗黙のbuild前提にせず`virune.json`へ明示します。

repositoryには小さな実行例として[`examples/user-directory`](../examples/user-directory)もあります。これは参考用のexampleであり、このガイドの規範的・canonicalなsourceではありません。

commandの正確な構文は[CLIリファレンス](cli-reference_ja.md)、実行可能なentry pointの条件は[entry point仕様](../spec/entry-point_ja.md)を参照してください。

## 2. infrastructureより先にdomainをモデル化する

applicationの概念は、名前の付いた型と明示的なdata modelで表します。

- 同じrepresentationでも交換可能にしたくない値には`newtype`を使う。
- 名前付きのdomain dataには`record`を使う。
- 閉じた選択肢やdomain failureには`enum`を使う。
- 値の不在には`Option<T>`または`T?`を使う。
- 関数contractに含める失敗には`Result<T, E>`を使う。
- `Option`、`Result`、enum variantは`match`で明示的に扱う。

nominal typeのconstructionやvalidationは、その型を所有するmoduleの近くに置きます。他moduleから使いやすくするためだけに内部のconstruction detailを公開せず、必要な操作だけを狭いpublic functionとして公開します。

`List`、`Map`、`Set`などのcollectionも、I/Oではなくdataを表すのであればdomain layerに置けます。正確なAPIは[標準ライブラリガイド](standard-library_ja.md)を参照してください。

型とvisibilityの厳密な規則は[types](../spec/types_ja.md)、[evaluation](../spec/evaluation_ja.md)、[modules](../spec/modules_ja.md)を参照してください。[言語ガイド](language-guide_ja.md)には検証済みexampleを含む、より広い入門があります。

## 3. effectをdependency boundaryへ置く

観測可能な処理はfunction signatureから見える状態を保ちます。たとえば、標準出力へ表示するcommand-line entry pointは`uses Console`を宣言します。一方、上位layerが結果を表示するだけなら、pureなdomain transformationまで`Console`を取得する必要はありません。

実践上は次のように分けます。

1. 可能な限りdomain transformationをpureに保つ。
2. moduleやfunctionの境界では通常のtyped dataを受け渡す。
3. 実際に副作用を実行するfunctionだけがbuilt-in effectを宣言する。
4. 上位layerがI/Oをorchestrateし、下位layerは狭いtyped contractを公開する。

この構成のためにVirune専用のdependency-injection frameworkは必要ありません。重要なのは、dependencyやeffectをhidden globalへ隠さないことです。

effectとcall compatibilityの厳密な規則は[types](../spec/types_ja.md)と[evaluation](../spec/evaluation_ja.md)を参照してください。

## 4. 非同期処理とcleanupを構造化する

Viruneに構造化された機能がある場合、detached JavaScript Promiseやad-hocなcleanupへ置き換えません。

- `async fn`で非同期operationを宣言する。
- `parallel`と`parallel try`でchild workを構造化されたgroupとして扱う。
- `await`でtask resultを待つ。
- postfix `?`で`Result` failureを伝播する。
- `defer`でlexical scopeへ決定的なcleanupを紐付ける。

重要なのはownershipです。child workは、それを作成したstructured operationへ紐付き、cleanupは登録したscopeへ紐付きます。

task、cancellation、structured concurrencyの厳密な意味論は[tasks](../spec/tasks_ja.md)、cleanupと評価順序は[evaluation](../spec/evaluation_ja.md)を参照してください。

## 5. JavaScript相互運用では最も狭いboundaryを選ぶ

実装が簡単になるという理由だけで、より弱いboundaryへAPIを移しません。external contractを正確に表現できる最も狭いboundaryから始めます。

### Generated binding

TypeScript declarationを保守的に表現できる場合は`virune bind`を使います。

```bash
virune bind ./types/example.d.ts \
  --module example-package \
  --out src/ffi/example.virune
```

未対応または安全に表現できないTypeScript shapeは、diagnosticを伴って`Unknown`として残ります。generated bindingはreview可能なsourceであり、生成されたという理由だけで自動的にtrustedになるわけではありません。

### TypeScript adapter

JavaScript／TypeScript APIをVirune Interop ABIへ渡す前にshapeを変換する必要がある場合は、`*.interop.ts` adapterを使います。

```bash
virune interop init example-package
virune interop check .
```

adapterは狭く明示的に保ちます。dependency API全体を複製するのではなく、Viruneが実際に利用するboundaryだけを公開します。

### Isolated unsafe FFI

safeな経路ではsafety contractを表現できず、そのboundaryを明示的にauditした場合だけ`unsafe extern`を使用します。raw unsafe externはprojectの`ffi/` boundary配下にある`unsafe module`へ置きます。通常のapplication codeからはreview済みfacadeだけを呼び出します。

実践的なmodelは[JavaScript／TypeScript連携](js-interop_ja.md)を参照してください。厳密なboundary規則は規範の[JavaScript FFI](../spec/ffi_ja.md)と[JavaScript interop仕様](../spec/js-interop_ja.md)が定義します。

## 6. Node.jsとbrowserのtargetを明示する

互換性のないplatform assumptionを1つのproject configurationへ隠しません。Node.jsとbrowserでentry pointが異なるapplicationでは、適切な`platform`を指定した別project rootまたは別configurationとして分けます。

platform固有dependencyは対応するboundaryの内側に置きます。shared moduleからNode-onlyまたはbrowser-only behaviorへ暗黙に依存しないようにします。

JavaScriptからVirune functionを直接呼び出す必要がある場合は、emitted implementation detailへ依存せず、サポートされた`@jsExport` boundaryを使います。

platformとmoduleの厳密な規則は[modules](../spec/modules_ja.md)、JavaScript exportの規則は[JavaScript FFI](../spec/ffi_ja.md)、executable entryの規則は[entry points](../spec/entry-point_ja.md)を参照してください。

## 7. 再現可能な検証loopを使う

repository専用のshowcase gateへ依存せず、公開CLIをprojectに対して実行します。

```bash
virune fmt --check .
virune check .
virune test .
virune build .
virune run .
```

Virune APIを公開するprojectでは、最初に決定的なsnapshotを作成し、その後の検証で同じsnapshotをcheckします。

```bash
virune api . --out virune.api.json
virune api . --out virune.api.json --check
```

TypeScript adapterを含む場合は、次も実行します。

```bash
virune interop check .
```

checked-in bindingの元になるTypeScript declarationやdependencyを変更した場合はbindingを再生成し、そのdiffをreviewします。CIでも、developerがlocalで再現できる同じpublic commandを使うことを基本とします。

commandの正確な構文は[CLIリファレンス](cli-reference_ja.md)を参照してください。

## 規範仕様とこのガイドの責務

| 確認したいこと | 参照先 |
|---|---|
| 通常のapplicationをどう構成するか | このガイド |
| 正確なtype／effect ruleは何か | [`spec/types.md`](../spec/types_ja.md) |
| 正確なevaluation／cleanup ruleは何か | [`spec/evaluation.md`](../spec/evaluation_ja.md) |
| 正確なasync／task ruleは何か | [`spec/tasks.md`](../spec/tasks_ja.md) |
| JavaScript boundaryで何が許可されるか | [`spec/ffi.md`](../spec/ffi_ja.md)と[`spec/js-interop.md`](../spec/js-interop_ja.md) |
| module／platformを越えて何が許可されるか | [`spec/modules.md`](../spec/modules_ja.md) |
| 有効なexecutable entry pointとは何か | [`spec/entry-point.md`](../spec/entry-point_ja.md) |
| CLIの正確な構文は何か | [CLIリファレンス](cli-reference_ja.md) |

application structureを選ぶときはこのガイドを使い、厳密な動作を確定するときは規範仕様を使います。

## 次に読むもの

- 小さな実行可能applicationは[`examples/user-directory`](../examples/user-directory)を参照する。
- より広い構文と意味論の入門は[言語ガイド](language-guide_ja.md)を参照する。
- foreign boundaryを設計するときは[JavaScript／TypeScript連携](js-interop_ja.md)を参照する。
- commandのbehaviorやoptionは[CLIリファレンス](cli-reference_ja.md)を参照する。
- compatibilityやcorrectnessの判断に厳密なVirune 1.0 behaviorが必要な場合は[規範仕様index](../spec/README_ja.md)を参照する。
