# Viruneでアプリケーションを構築する

[English](application-guide.md) | [日本語](application-guide_ja.md)

このガイドは、空のプロジェクトから小さなViruneアプリケーションを構築するまでのタスク指向ルートです。公開Virune 1.0機能を実際にどう組み合わせるかを、repository-ownedの[feature showcase](../examples/feature-showcase/README_ja.md)へ直接対応付けて説明します。

このガイドのcanonical executable sourceはfeature showcaseです。Virune sourceや実行command blockを別のsnippetとして複製しません。exampleが変わったときに、review・検証すべきsourceを1か所に保つためです。

> [!IMPORTANT]
> このガイドは説明用であり、規範仕様ではありません。Virune 1.0の厳密な動作は[`spec/`](../spec/README_ja.md)配下が定義します。このガイドと規範仕様が食い違う場合は、規範仕様を優先します。

## アプリケーション構築の流れ

実践的なViruneアプリケーションは、次の6段階で構成できます。

1. 名前的なデータ型と明示的な不在・失敗でdomainをモデル化する。
2. effectをdependency boundaryへ置く。
3. 非同期処理とcleanupを構造化する。
4. 必要条件を満たす最も狭いJavaScript相互運用tierを選ぶ。
5. Node.js targetとbrowser targetを明確に分ける。
6. format、check、test、API、build、executionを同じ検証loopで回す。

feature showcaseは小さなuser-directory scenarioを使い、これらを孤立した構文例ではなく1つのapplicationとして見せます。

## 1. 先にdomainをモデル化する

まず[`examples/feature-showcase/node/src/domain.virune`](../examples/feature-showcase/node/src/domain.virune)を確認してください。

このファイルでは、主要なdomain modelingの選択肢を組み合わせています。

- `newtype UserId = Int`によって、すべての整数を交換可能にせずidentifierへ名前的identityを与える。
- `record User`でdomain dataをまとめる。
- `enum DirectoryError`でapplicationの失敗caseを明示する。
- `String?`でimplicit nullableではなく`Option<String>`としてemailの不在を表す。
- `Result<User, DirectoryError>`でvalidation failureを関数contractへ含める。
- `match`で`Option`と`Result`を明示的に処理する。

nominal typeのconstructionとvalidationは、その型を所有するmoduleの近くに置きます。showcaseはprivateなnominal constructorをmodule外へ漏らさず、`createUserFromInt`を公開境界にしています。

collectionがeffectではなくdataを表すなら、同じdomain layerへ置けます。[`collections.virune`](../examples/feature-showcase/node/src/collections.virune)はI/Oを追加せず`List`、`Map`、`Set`を扱います。

厳密な規則は規範の[型システム](../spec/types_ja.md)、[評価規則](../spec/evaluation_ja.md)、[module規則](../spec/modules_ja.md)を参照してください。より広い学習用解説は[言語ガイド](language-guide_ja.md)にあります。

## 2. effectをdependency boundaryへ置く

次に[`examples/feature-showcase/node/src/main.virune`](../examples/feature-showcase/node/src/main.virune)を確認してください。

実行可能な`main`関数は、出力という観測可能な副作用があるため`uses Console`を宣言します。一方、domainとcollectionの関数は`Console`を宣言せず、通常の値を受け取り、通常の値または明示的な`Result`を返します。

これがViruneでの実践的なdependency-boundary patternです。

- 可能な限りdomain transformationをpureに保つ。
- dependencyをglobalへ隠さず、module／function boundaryを通じてdataを渡す。
- 実際に必要とする関数でbuilt-in effectを`uses`に宣言する。
- 上位layerでeffectful workをorchestrateし、下位layerは狭いtyped contractを公開する。

このpatternのためにVirune専用のdependency-injection frameworkは必要ありません。重要なのは、dependencyとeffectがsignatureとmodule boundaryから見えることです。

effectとcall compatibilityの厳密な規則は[types](../spec/types_ja.md)と[evaluation](../spec/evaluation_ja.md)が規範です。

## 3. 非同期処理とcleanupを構造化する

[`examples/feature-showcase/node/src/workflow.virune`](../examples/feature-showcase/node/src/workflow.virune)がcanonical concurrency exampleです。

次の順序で読むと関係を把握しやすくなります。

1. `async fn`で非同期に完了するoperationを表す。
2. `parallel try`で独立したoperationを1つのstructured groupとして開始する。
3. `await`でgroup resultを待つ。
4. postfix `?`でunchecked exception pathを増やさず`Result` failureを伝播する。
5. `defer`でscopeに決定的なcleanupを登録する。

重要なのはownershipです。非同期child workは、それを生成したstructured operationに紐づき、cleanupはlexical scopeに紐づきます。Viruneに構造化されたconstructがある場合、detached JavaScript Promiseやad-hoc cleanupへ置き換えないでください。

taskとcancellationの厳密な意味論は規範の[task規則](../spec/tasks_ja.md)、cleanupと評価順序は[評価規則](../spec/evaluation_ja.md)が定義します。

## 4. JavaScript相互運用tierを選ぶ

JavaScript APIを安全に表現できる最も狭いboundaryを使います。showcaseには3 tierすべてがあります。

### Tier 1: generated safe binding

- Declaration input: [`node/types/node-os-showcase.d.ts`](../examples/feature-showcase/node/types/node-os-showcase.d.ts)
- Generated Virune binding: [`node/src/ffi/node-os.virune`](../examples/feature-showcase/node/src/ffi/node-os.virune)

TypeScript surfaceを保守的に表現でき、Runtimeで検証できる場合は`virune bind`を使います。未対応shapeは`Unknown`のまま扱うか別tierへ移し、より強いVirune型を推測してはいけません。

### Tier 2: TypeScript adapter

- Adapter: [`node/src/interop/read-file.interop.ts`](../examples/feature-showcase/node/src/interop/read-file.interop.ts)

JavaScript／TypeScript APIのshapeをVirune Interop ABIへ直接渡すべきでない場合はAdapterを使います。showcaseではNodeのcallback-based `readFile` contractをTypeScript内へ閉じ込め、monomorphicかつcallback-freeな`Promise<string>` boundaryを公開します。

### Tier 3: isolated unsafe FFI

- Audited source fixture: [`node/src/ffi/unsafe-hostname.virune.example`](../examples/feature-showcase/node/src/ffi/unsafe-hostname.virune.example)

safe tierではsafety contractを表せず、かつboundaryを明示的にauditした場合だけ`unsafe extern`を使用します。raw externはprojectの`ffi/` boundaryにある`unsafe module`内へ置き、通常のapplication codeからはreview済みfacadeだけを呼び出します。

repository showcaseで`.virune.example` suffixを使用しているのは意図的です。repository-root scanとnested projectの`src/ffi/`ではsource rootが異なります。fixtureをnon-discoverableに保つことでroot側unsafe-path ruleを緩和しません。Issue #81が、このfixtureをshowcase project自身の`src/ffi/` contextへstageし、project scopeで継続検証する責務を持ちます。

実践的な相互運用modelは[JavaScript／TypeScript連携](js-interop_ja.md)を参照してください。厳密なboundary規則は規範の[JavaScript FFI](../spec/ffi_ja.md)と[three-tier interop仕様](../spec/js-interop_ja.md)が定義します。

## 5. Node.js targetとbrowser targetを分離する

showcaseはplatform assumptionを隠した1つのconfigurationではなく、2つのproject configurationを持ちます。

- Node.js: [`examples/feature-showcase/node/virune.json`](../examples/feature-showcase/node/virune.json)
- Browser: [`examples/feature-showcase/browser/virune.json`](../examples/feature-showcase/browser/virune.json)

Node projectは実行可能CLI scenario、Node interop、test、public API snapshotを所有します。browser projectはbrowser-target buildと[`@jsExport` boundary](../examples/feature-showcase/browser/src/main.virune)を所有します。

platform固有dependencyは対応するproject boundaryの内側に保ちます。shared moduleへNode-onlyまたはbrowser-only behaviorを暗黙に漏らしてはいけません。

厳密なplatform／module規則は[modules](../spec/modules_ja.md)、executable entry規則は[entry point](../spec/entry-point_ja.md)が定義します。

## 6. 1つの検証loopを使う

正確な実行commandはcanonical showcaseの[Repositoryから検証する手順](../examples/feature-showcase/README_ja.md#repositoryから検証する)だけに保持します。このガイドでは、driftし得る別のcommand blockを複製せず、それぞれの役割を説明します。

次の順序でworkflowを実行します。

1. Node.jsとbrowser両projectに`fmt --check`を実行する。
2. Nodeで`check`と`test`を実行する。
3. checked-in public API snapshotに対してNodeの`api --check`を実行する。
4. Nodeで`build`と`run`を実行する。
5. browserで`check`と`build`を実行する。
6. checked-in TypeScript declaration fixtureから`bind`でsafe bindingを再生成し、generated outputがdriftしていないことを確認する。
7. `interop check`でTypeScript adapterを検証する。

自分のprojectでインストール済みVirune CLIを使う場合は、対応する`virune` commandを直接実行します。`virune init`で作成したprojectには、生成READMEに共通npm scriptも記載されます。

checked-in [`virune.api.json`](../examples/feature-showcase/node/virune.api.json)もcontractの一部です。`api --check`はpublic surface driftを検出し、snapshotを黙って書き換えません。

Issue #81は、このshowcase loop全体—real browser execution、generated-output drift、project-scoped unsafe FFI validationを含む—をPull Requestごとの継続quality gateにする責務を持ちます。このガイドは、そのfollow-upがすでに完了したとは扱いません。

## 規範仕様とこのガイドの責務

| 確認したいこと | 参照先 |
|---|---|
| 通常のapplicationをどう構成するか | このガイドとfeature showcase |
| 正確なtype／effect ruleは何か | [`spec/types.md`](../spec/types_ja.md) |
| 正確なevaluation／cleanup ruleは何か | [`spec/evaluation.md`](../spec/evaluation_ja.md) |
| 正確なasync／task ruleは何か | [`spec/tasks.md`](../spec/tasks_ja.md) |
| JavaScript boundaryで何が許可されるか | [`spec/ffi.md`](../spec/ffi_ja.md)と[`spec/js-interop.md`](../spec/js-interop_ja.md) |
| module／platformを越えて何が許可されるか | [`spec/modules.md`](../spec/modules_ja.md) |
| 有効なexecutable entry pointとは何か | [`spec/entry-point.md`](../spec/entry-point_ja.md) |

設計を選ぶときはこのガイドを使い、厳密な動作を確定するときは規範仕様を使います。

## canonical showcaseへのtraceability

| Task | Canonical source | 厳密な規則 |
|---|---|---|
| Domain modeling | [`domain.virune`](../examples/feature-showcase/node/src/domain.virune) | [`types.md`](../spec/types_ja.md)、[`evaluation.md`](../spec/evaluation_ja.md) |
| Collections | [`collections.virune`](../examples/feature-showcase/node/src/collections.virune) | [`standard-library.md`](../spec/standard-library_ja.md) |
| Effects / executable boundary | [`main.virune`](../examples/feature-showcase/node/src/main.virune) | [`types.md`](../spec/types_ja.md)、[`entry-point.md`](../spec/entry-point_ja.md) |
| Structured concurrency / cleanup | [`workflow.virune`](../examples/feature-showcase/node/src/workflow.virune) | [`tasks.md`](../spec/tasks_ja.md)、[`evaluation.md`](../spec/evaluation_ja.md) |
| Virune-native tests | [`showcase.spec.virune`](../examples/feature-showcase/node/src/showcase.spec.virune) | [言語ガイド](language-guide_ja.md) |
| Public API snapshot | [`virune.api.json`](../examples/feature-showcase/node/virune.api.json) | [CLIリファレンス](cli-reference_ja.md) |
| Safe binding | [`node-os.virune`](../examples/feature-showcase/node/src/ffi/node-os.virune) | [`ffi.md`](../spec/ffi_ja.md) |
| TypeScript adapter | [`read-file.interop.ts`](../examples/feature-showcase/node/src/interop/read-file.interop.ts) | [`js-interop.md`](../spec/js-interop_ja.md) |
| Isolated unsafe FFI | [`unsafe-hostname.virune.example`](../examples/feature-showcase/node/src/ffi/unsafe-hostname.virune.example) | [`ffi.md`](../spec/ffi_ja.md) |
| Node/browser split | [`node/virune.json`](../examples/feature-showcase/node/virune.json)、[`browser/virune.json`](../examples/feature-showcase/browser/virune.json) | [`modules.md`](../spec/modules_ja.md) |

## 次に読むもの

- 正確な実行commandとfile layoutは[feature showcase README](../examples/feature-showcase/README_ja.md)を参照してください。
- 構文と意味論を広く学ぶ場合は[言語ガイド](language-guide_ja.md)を参照してください。
- foreign boundaryを詳しく設計する場合は[JavaScript連携ガイド](js-interop_ja.md)を参照してください。
- compatibilityやcorrectnessの判断がVirune 1.0の厳密な動作へ依存する場合は[規範仕様index](../spec/README_ja.md)を参照してください。
