# フロントエンドのコンポーネントとViewの記述

[英語版](frontend.md)

この文書は、Virune固有のフロントエンド記述機能を定義します。対象はソースコードの書き方と言語としての意味です。描画、リアクティビティ、JSX変換、コンポーネントライブラリ、ルーティング、CSS、HMR、バンドル処理など、フレームワーク固有の機能は引き続きJavaScript側のエコシステムが担います。

## `[frontend.component-declaration]` コンポーネント宣言

`component`宣言はフロントエンド側のホストから呼び出される境界であり、通常のViruneの`fn`とは異なります。

```virune
internal component UserPage(user: User) uses JavaScript {
    return view {
        main(className: "page") {
            { user.name }
        }
    }
}
```

コンポーネントには通常の型付き引数と必須の`uses`節があります。一方、型パラメーター一覧、`async`修飾子、式本体、明示的な戻り値型は指定できません。コンポーネントは通常のViruneの呼び出し可能な値ではないため、通常の関数呼び出し構文では呼び出せません。

## `[frontend.component-visibility]` コンポーネントの可視性

コンポーネントは、修飾子を付けなければモジュール内でのみ使用できます。`internal component`は`[module.visibility]`で定義されたパッケージまたはアプリケーションのスコープに属し、同じスコープにある別のViruneモジュールからインポートできます。

Virune 1.0では、公開された`pub component`に対する安定したABIを定義しません。`pub component`宣言は、通常の公開関数やJavaScriptへの簡易的なエクスポートとはみなさず、拒否します。

## `[frontend.component-effects]` コンポーネントの副作用

フロントエンドのホストとJSXの境界はJavaScript側が管理するため、コンポーネントでは`JavaScript`副作用を明示的に宣言しなければなりません。必要に応じて、ほかの具体的な副作用も通常どおり宣言できます。

コンポーネント用に別の副作用システムは設けず、通常の副作用チェックも緩和しません。

## `[frontend.view-containment]` 名前を付けられないViewの結果

`view`は、コンパイラーが管理する、型名を持たないViewの結果を生成します。ソースコード上で使用できる`View`型は定義せず、Viewの結果を`Unknown`や一般の`External`値として扱うこともありません。

Viewの結果は、次の位置でのみ使用できます。

- `component`から直接返す値
- 入れ子になったViewの子要素
- View内の宣言的な条件分岐または繰り返しの本体
- 後述する、コンパイラー管理下のVirune固有コンポーネントの子スロット

Viewの結果を`let`/`const`変数、レコード、リスト、タプルなどの通常の値に保存することはできません。また、通常の関数呼び出しへの受け渡し、通常のAPI値としてのエクスポート、フィールドやインデックスによるアクセス、一般の`External`値への変換、通常の`fn`からの返却もできません。

コンポーネントの戻り値を返すすべての経路では、View構造を直接返さなければなりません。View以外の値を返す場合や、Viewを返さずに処理が終わる経路がある場合は拒否します。

## `[frontend.view-elements]` 要素とコンポーネントの参照

View要素のタグ名には、識別子、またはドットで区切った識別子・メンバーパスを使用します。

```virune
view {
    main()
    ui.Button()
}
```

パーサーは、タグをReact、Preact、Solid、Vue、組み込み要素、サードパーティーのコンポーネントなどに分類しません。そのタグがフレームワークやライブラリで有効かどうかは、後段でプロジェクトが実際に使用するTypeScriptのJSX環境から判定します。

要素は空でも、入れ子のViewブロックを持っていても構いません。ルートに複数の子要素があっても有効で、Fragment相当の結果を表します。記述構文の都合だけでラッパー要素を要求することはありません。

## `[frontend.view-properties]` プロパティ

Viewのプロパティは、プロパティ名と通常のVirune式を対応付けます。

```virune
Button(onClick: logout, "data-state": state) {
    "Logout"
}
```

プロパティ名には通常の識別子を使用できます。Viruneの識別子として表せない名前には、引用符付きの文字列を使用できます。Viruneは`class`を`className`に変換するようなフレームワーク固有の名前の書き換えを行わず、フレームワーク固有のディレクティブ構文も定義しません。

プロパティに指定する式は通常のVirune式です。View内に書いたという理由だけで、Viewや`External`の値を外へ持ち出せるようにはなりません。

ただしJavaScript-imported External elementには、compiler-controlledな狭い例外を1つだけ設ける。property valueとして直接置かれたsynchronous lambdaは、projectが実際に使用するTypeScript JSX environmentがそのpropertyをcallbackとしてcontextually証明できる場合に限り、directな`view { ... }` expression bodyを持てる。annotationのないcallback parameterはconcreteかつcurrentなprovider evidenceからのみ取得し、初期boundaryではprovider-provenなExternal object parameterだけを受理する。`any`、`unknown`、`never`、unresolved generic、stale、partial、ambiguous、その他unsupportedなevidenceはrejectする。このView resultは引き続きnon-nameableであり、その正確なcallback位置からescapeできない。

callbackはdownstream JSX property positionのままemitし、View bodyをhost toolchain向けにpreserveする。ViruneはView resultをcomponent entryでhoistまたはsnapshotしてはならない。generated callbackは、View resultをgeneral External valueへ分類せず、既存のJavaScript callback root-contextおよびerror-isolation machineryを再利用する。その後、actual View resultを含む完全なgenerated callback usageをprojectのTypeScript JSX whole-usage environmentでvalidateする。package名、framework名、property名によってこのcapabilityを判定してはならない。async View-producing callbackはこの初期contractの対象外でありrejectする。

## `[frontend.view-children]` テキストと式の子要素

文字列リテラルはテキストの子要素になります。通常のVirune式は、Viewの子要素の位置で`{`と`}`で囲むと、式の子要素になります。

```virune
view {
    p() {
        "User: "
        { user.name }
    }
}
```

この波括弧はViewを記述する位置でだけ意味を持つ区切りであり、Virune全体の式構文を変更するものではありません。括弧内の式には通常のVirune式の規則が適用され、副作用やJavaScriptとの境界に関する規則も変わりません。先頭に`= expression`を書く形式は、Viewの式の子要素として認められません。

## `[frontend.view-conditional]` 宣言的なViewの条件分岐

View内の`if`は、View専用の宣言的な構文です。

```virune
view {
    if loggedIn {
        Dashboard()
    } else {
        Login()
    }
}
```

条件には通常のVirune式を使用し、各分岐の本体はViewブロックになります。`else`を省略して条件が偽になった場合、その条件分岐は子要素を生成しません。これはFragment相当の構造上の不在を表すもので、代わりの値を評価したり生成したりしません。

コンパイラーは、後段のフロントエンド処理に渡すため、`else`を省いた場合の子要素がない分岐も含めて、条件分岐のソース上の位置と評価位置を維持しなければなりません。フレームワークが管理するリアクティビティや遅延評価を変えてしまうような、条件分岐やホスト依存の分岐式の事前の移動・値の固定・キャッシュは認められません。

no-`else`のabsence branchのために導入するempty Fragmentは、JavaScript-imported External componentから観測可能なchild valueになる位置では使用してはならない。downstream componentのchildren/slot semanticsを変えずにzero-child absenceを保存できることが証明されるまで、そのdirect External child structure内のno-`else` conditionalは成功へ推測せずrejectする。

## `[frontend.children-slot]` コンパイラー管理下の子スロット

View構造内で単独で書かれた`children`は、現在のVirune固有コンポーネントに対する、コンパイラー管理下の子スロットを表します。

```virune
internal component Panel(title: String) uses JavaScript {
    return view {
        section() {
            h2() {
                { title }
            }
            children
        }
    }
}
```

`children`は言語全体の予約語ではなく、使用する位置によって意味が決まります。Viewの子要素として単独で書く場合を除き、引数名、ローカル変数名、フィールド名、式中の名前など、通常のVirune識別子として利用できます。子スロットを表すのは、Viewの子要素の位置に単独で書いた`children`だけです。

このスロットは通常の引数、呼び出し可能な値、`External`値、Reactの`props.children`、Vueのスロットオブジェクト、Solidのアクセサー、その他のフレームワーク固有APIではありません。Virune 1.0では、コンポーネントごとにスロットを置けるのは最大1回です。複数回の配置は、フレームワークごとに異なる再評価や遅延評価の規則を言語側で作り出さないように、拒否します。

後段のコンパイラー管理下での値の受け渡しと変換処理は、一般のView値を外部へ公開せず、実際のフロントエンドフレームワークが必要とする評価位置と遅延評価の性質を保たなければなりません。

compiler-managed slotをJavaScript-imported External componentから観測可能なdirect child valueにしてはならない。downstreamのchildren/slot semanticsを変えずにそのzero-or-more child contributionを保存できることが証明されるまで、そのdirect External child structure内のstandalone `children`はrejectする。External componentの下でもintrinsic element配下にnestedされたslotは、通常のView validation対象として引き続き利用できる。

## `[frontend.view-repetition]` 宣言的なViewの繰り返し

View内の`for`は専用の宣言的な構文であり、通常の命令的な`ForStatement`とは異なります。Viewの繰り返しには、論理的な同一性（identity）を明示する必要があります。

```virune
view {
    for user, index in users by user.id {
        UserRow(user: user, position: index)
    }
}
```

`by`はView repetition内だけのcontextual syntaxであり、それ以外では通常のidentifierとして利用できる。identity expressionはcurrent itemとoptional source-index bindingが利用可能になった後に評価する。checked typeは`String`または`Int`でなければならず、unresolvedまたはunsupportedなidentity evidenceはrejectする。StringとIntのidentityは異なるtagged domainとして扱う。1 snapshot内で2つのvisited itemが同じtagged identityを生成した場合、Host reconciliationやView body executionより前にrejectする。

Viruneはsource index、transportされたJavaScript object identity、`key`等のchild property、`id`等のfield名、framework/package conventionからidentityを推論しない。identity-freeなView repetitionはstable language surfaceに含めない。

identity-bearing repetitionは、project-ownedなRepetition Hostを正確に1つ通して評価する。projectは既存のdeclaration attributeと`extern js` surfaceを使ってHostを宣言する。

```virune
@repetitionHost("render", 1)
extern js "./repetition-host.js" {}
```

`@repetitionHost` attributeはsafeな`extern js` declarationにだけ指定できる。引数は正確に2つのliteral、すなわちStringのexport nameとIntのprotocol version `1`でなければならない。それ以外のargument shapeまたはprotocol versionはrejectする。View repetitionをemitするprojectはvalidなproject-owned locatorを正確に1つresolveしなければならず、複数のvalid locatorはambiguousとしてfail closedとする。

protocol version 1のcompiler-visibleなcall shapeは概念上次の通りである。

```ts
repetitionHost(
  readSnapshot: () => readonly { id: string; index: number; value: T }[],
  renderGroup: (
    readValue: () => T,
    readIndex: () => number,
    id: string,
  ) => FrameworkOwnedView,
)
```

compilerはsnapshot traversal、identity encoding、duplicate detection、安全なtransport/capture check、およびHost callを所有する。project Hostとdownstream frameworkはreconciliation、keyed representation、scheduling、lifecycle、renderingを所有する。callback invocation countはViruneの保証ではない。

Host locatorはproject-ownedである。dependency packageがprojectのrepetition Hostを暗黙選択してはならない。missing、malformed、unsupported、ambiguous、その他証明不能なHost evidenceはfail closedとし、affected outputを抑止する。relative Host moduleはlocator declarationを基準にresolveし、emitted consumer向けにrebaseする。located exportはprojectのcurrent TypeScript whole-usage environmentでvalidateし、ViruneはTypeScript function assignabilityを再実装せず、framework名でも分岐しない。

1つのlogical identityは1 iterationの完全なView resultを所有する。1 iterationが複数childを生成する場合、それらはdownstream reconciliation上も1つのidentity-owned groupとして保持される。nested identity repetitionは同じHost contractを通してcomposeする。

## `[frontend.view-repetition-source]` 繰り返し元の境界

初期repetition sourceはhost-safeなnative `List<T>`と、current interop provider snapshotからarray shapeおよびindexed-element shapeが証明されたJavaScript External `Array<T>` / `ReadonlyArray<T>`に限定する。

External arrayをnative `List`へ暗黙変換しない。`any`、`unknown`、unsupported collection、またはunresolved、stale、partial、ambiguousなprovider evidenceはfail closedとする。

Host-triggeredな各`readSnapshot()` evaluationにつきsource expressionは正確に1回だけ評価する。External arrayではinitial `length`を正確に1回観測し、その観測済みlengthまでindex 0から順にvisitし、sparse holeをskipし、visited itemは各1回だけreadする。optional index bindingはoutput ordinalではなく0始まりのsource indexである。

source、transportされるitem、identity expression、View bodyはいずれもHost-deferred boundaryを跨ぐため、frontend lifetime/transport safety ruleを満たさなければならない。Resource/capability value、raw native callable、lifetime-boundまたはmust-use value、unresolved/open shapeその他deferred safetyを証明できない値はrejectする。userが明示的に作成したsnapshotは通常のVirune semanticsのままとし、compilerがreactive Host位置へ戻してはならない。

Generic `Iterable`、`AsyncIterable`、`Set`、`Map`、arbitrary array-likeはこの初期contractの対象外である。

## `[frontend.view-repetition-children]` 繰り返しと子要素の境界

compiler-managed standalone `children` slotは、nested View conditionalやnested repetitionを経由する場合も含め、repetition subtree内のどこにあってもrejectする。repetitionは`break`、`continue`、assignment、imperative loop-body semanticsを導入しない。

生成されるHost callは、projectのTypeScript whole-usage environmentへactual parent JSX positionのまま提出する。JavaScript-imported External componentのdirect childも同様であり、acceptanceは具体的なHost resultとdownstream children contractで決まり、compiler-generated structural arrayやframework-specific exceptionには依存しない。

## `[frontend.framework-neutral]` フレームワーク非依存のコア

component/View grammarはframeworkを選択しない。Virune Coreはframework-name enum、package-name heuristic、Virune frontend VDOM/runtime、universal state/effect/router API、property vocabulary rewrite、framework固有JSX loweringを定義しない。

External component validity、props、children、overload、generic、contextual callback typingは、projectが実際に使用するTypeScript JSX environmentとJavaScript interoperability contractを通じて証明する。unknown、stale、partial、ambiguousなJavaScript/TypeScript evidenceは引き続きfail-closedとする。
