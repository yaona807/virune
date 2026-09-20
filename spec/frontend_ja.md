# Frontend Component / View Authoring

[English](frontend.md)

この文書は、Virune-nativeなFrontend authoring surfaceを定義する。ここで定義するのはsourceと言語semanticsであり、framework固有のrendering、reactivity、JSX変換、component library、router、CSS、HMR、bundlingはdownstream JavaScript ecosystemが所有する。

## `[frontend.component-declaration]` Component declaration

`component` declarationはfrontend hostから呼び出されるboundaryであり、通常のVirune `fn`とは異なる。

```virune
internal component UserPage(user: User) uses JavaScript {
    return view {
        main(className: "page") {
            { user.name }
        }
    }
}
```

componentは通常のtyped parameterと必須の`uses` clauseを持つが、type parameter list、`async` modifier、expression body、明示return typeは持たない。componentは通常のVirune callable valueではなく、通常のcall syntaxから呼び出せない。

## `[frontend.component-visibility]` Component visibility

componentはmodifierなしではmodule-privateである。`internal component`は`[module.visibility]`で定義されたpackage/application scopeを使用し、同一の既知scopeに属する別Virune moduleからimportできる。

Virune 1.0はstableなpublished `pub component` ABIを定義しない。`pub component` declarationは、通常のpublished functionやJavaScript export shortcutとして扱わずrejectする。

## `[frontend.component-effects]` Component effects

frontend hostとJSX boundaryはJavaScript側が所有するため、componentは`JavaScript` effectを明示的に宣言しなければならない。追加のconcrete effectは通常どおり宣言できる。

component formは第2のfrontend effect systemを作らず、通常のeffect checkingを弱めない。

## `[frontend.view-containment]` Non-nameable View result

`view`はcompiler-controlledでnon-nameableなView resultを生成する。Viruneはsource-levelの`View`型を定義せず、View resultを`Unknown`やgeneral `External` valueとして分類しない。

View resultは次の用途に限ってconsumeできる。

- `component`のdirect return value
- nested View child structure
- View-local declarative conditionalまたはrepetition body
- 下記で定義するcompiler-managed native-component child slot

View resultは、`let`/`const`、record、list、tupleその他の通常valueへ保存できない。通常callへ渡せず、通常API valueとしてexportできず、field/index accessできず、general External valueへprojectできず、通常の`fn`からreturnできない。

componentのすべてのreturning pathはView structureをdirectにreturnしなければならない。non-View return、またはViewをreturnせずcomponent pathが完了する場合はrejectする。

## `[frontend.view-elements]` Element / component reference

View elementのtag spellingにはidentifierまたはdotted identifier/member pathを使う。

```virune
view {
    main()
    ui.Button()
}
```

parserはtagをReact、Preact、Solid、Vue、intrinsic element、third-party component等へ分類しない。framework/library上のvalidityは、後段でprojectが実際に使用するTypeScript JSX environmentから判定する。

elementは空でもnested View blockを持ってもよい。複数root childはvalidで、fragment-equivalent outputを表す。authoring grammarの都合だけでwrapper elementを要求しない。

## `[frontend.view-properties]` Property

View propertyはproperty nameと通常のVirune expressionを対応づける。

```virune
Button(onClick: logout, "data-state": state) {
    "Logout"
}
```

property nameには通常のidentifier name、または通常のVirune identifierで表せない名前のためのquoted stringを使える。Viruneは`class`から`className`への変換のようなframework vocabulary rewriteを行わず、framework固有directive syntaxを定義しない。

property expressionは通常のVirune expressionであり、View内にあることだけを理由にViewまたはExternal escape semanticsを得ない。

## `[frontend.view-children]` Text / expression child

string literalはtext childである。通常のVirune expressionは、View child位置で`{`と`}`に囲んだときexpression childになる。

```virune
view {
    p() {
        "User: "
        { user.name }
    }
}
```

このbraceはcontextualなView authoring delimiterであり、Viruneの一般expression syntaxを変更するものではない。内側のexpressionは通常のVirune expression semanticsに従い、通常のeffectおよびJavaScript boundary ruleを引き続き受ける。先頭`= expression`はView expression-child formではない。

## `[frontend.view-conditional]` Declarative View conditional

View-local `if`は専用のdeclarative View constructである。

```virune
view {
    if loggedIn {
        Dashboard()
    } else {
        Login()
    }
}
```

conditionは通常のVirune expressionであり、branchはView blockである。`else`を省略しconditionがfalseの場合、そのconditionalはView childを0個だけ寄与する。この不在はfragment-equivalentなstructural outputであり、fallback valueを評価または合成するものではない。

compilerはdownstream frontend processingのため、no-`else`のabsence branchを含めconditionalのsource/evaluation positionを保存しなければならない。frameworkが所有するreactivity/lazinessを変える形でconditionalやhost-sensitive branch expressionを先行hoist、snapshot、cacheしてはならない。

no-`else`のabsence branchのために導入するempty Fragmentは、JavaScript-imported External componentから観測可能なchild valueになる位置では使用してはならない。downstream componentのchildren/slot semanticsを変えずにzero-child absenceを保存できることが証明されるまで、そのdirect External child structure内のno-`else` conditionalは成功へ推測せずrejectする。

## `[frontend.children-slot]` Compiler-managed native children slot

View structure内でstandaloneの`children`は、現在のVirune-native componentに対するcompiler-managed child slotを表す。

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

このslot spellingはglobal reserved wordではなくcontextual formである。standaloneなView childという正確な位置以外では、`children`はparameter、local、field、expression nameを含む通常のVirune identifierとして引き続き利用できる。compiler-managed slotを表すのはView child位置のstandalone `children`だけである。

そのslot自体は通常parameter、callable、External value、React `props.children`、Vue slot object、Solid accessorその他のframework固有APIではない。Virune 1.0では1 componentにつきこのslotを配置できるのは最大1回とする。複数配置は、frameworkごとに異なるrepeated evaluation/laziness semanticsを言語側で発明しないためrejectする。

後段のcompiler-owned transport/loweringは、general View valueを公開せず、実frontend frameworkに必要なsource evaluation/lazinessを保存しなければならない。

compiler-managed slotをJavaScript-imported External componentから観測可能なdirect child valueにしてはならない。downstreamのchildren/slot semanticsを変えずにそのzero-or-more child contributionを保存できることが証明されるまで、そのdirect External child structure内のstandalone `children`はrejectする。External componentの下でもintrinsic element配下にnestedされたslotは、通常のView validation対象として引き続き利用できる。

## `[frontend.view-repetition]` Declarative View repetition

View-local `for`は専用のdeclarative View constructであり、通常のimperative `ForStatement`とは別物である。View repetitionには明示的なlogical identityが必須である。

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

## `[frontend.view-repetition-source]` Repetition source boundary

初期repetition sourceはhost-safeなnative `List<T>`と、current interop provider snapshotからarray shapeおよびindexed-element shapeが証明されたJavaScript External `Array<T>` / `ReadonlyArray<T>`に限定する。

External arrayをnative `List`へ暗黙変換しない。`any`、`unknown`、unsupported collection、またはunresolved、stale、partial、ambiguousなprovider evidenceはfail closedとする。

Host-triggeredな各`readSnapshot()` evaluationにつきsource expressionは正確に1回だけ評価する。External arrayではinitial `length`を正確に1回観測し、その観測済みlengthまでindex 0から順にvisitし、sparse holeをskipし、visited itemは各1回だけreadする。optional index bindingはoutput ordinalではなく0始まりのsource indexである。

source、transportされるitem、identity expression、View bodyはいずれもHost-deferred boundaryを跨ぐため、frontend lifetime/transport safety ruleを満たさなければならない。Resource/capability value、raw native callable、lifetime-boundまたはmust-use value、unresolved/open shapeその他deferred safetyを証明できない値はrejectする。userが明示的に作成したsnapshotは通常のVirune semanticsのままとし、compilerがreactive Host位置へ戻してはならない。

Generic `Iterable`、`AsyncIterable`、`Set`、`Map`、arbitrary array-likeはこの初期contractの対象外である。

## `[frontend.view-repetition-children]` Repetition child boundary

compiler-managed standalone `children` slotは、nested View conditionalやnested repetitionを経由する場合も含め、repetition subtree内のどこにあってもrejectする。repetitionは`break`、`continue`、assignment、imperative loop-body semanticsを導入しない。

Host-backed repetitionをJavaScript-imported External componentのdirect childとして使う場合、exact Host resultがその直接観測可能なdownstream children shapeに適合することを証明できるまではfail closedとする。External componentの下でもintrinsic element配下にnestedされたrepetitionは通常のvalidation対象として扱える。この制約は保守的なproof boundaryであり、compiler-owned structural array expansionやframework-specific loweringを復活させる根拠にはならない。

## `[frontend.framework-neutral]` Framework-neutral core

component/View grammarはframeworkを選択しない。Virune Coreはframework-name enum、package-name heuristic、Virune frontend VDOM/runtime、universal state/effect/router API、property vocabulary rewrite、framework固有JSX loweringを定義しない。

External component validity、props、children、overload、generic、contextual callback typingは、projectが実際に使用するTypeScript JSX environmentとJavaScript interoperability contractを通じて証明する。unknown、stale、partial、ambiguousなJavaScript/TypeScript evidenceは引き続きfail-closedとする。
