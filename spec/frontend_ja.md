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

## `[frontend.view-repetition]` Declarative View repetition

View-local `for`は専用のdeclarative View constructであり、通常のimperative `ForStatement`とは別物である。

```virune
view {
    for user in users {
        UserRow(user: user)
    }

    for user, index in users {
        UserRow(user: user, position: index + 1)
    }
}
```

1回のdownstream-host repetition evaluationにつきsource expressionは正確に1回だけ評価する。itemは0始まりのsource index昇順でvisitし、visitしたitemは各1回だけreadする。optionalなindex bindingはemitted childのordinalではなく、そのsource indexを表す。

各itemのView bodyはsource orderで評価する。1 itemが複数のView childを生成する場合、それらはcompiler-ownedな1本のflat ordered child sequenceへ順番に追加する。Viruneはitemごとの暗黙Fragment/group identityを定義せず、framework固有のarray flatteningにこの順序の意味を委ねない。

repetitionを`source.map(...)`その他のoverride可能なcollection methodとして定義しない。compilerはhost-sensitiveなsource expressionをdownstream-host evaluation位置の外へhoist、snapshot、cacheしてはならない。body内の`key` propertyは通常のdownstream View propertyのままであり、Virune Coreのidentity/reconciliation semanticsを持たない。

## `[frontend.view-repetition-source]` Repetition source boundary

初期repetition sourceはhost-safeなnative `List<T>`と、現在のinterop provider snapshotからarray shapeおよびindexed element shapeが証明されたJavaScript External `Array<T>` / `ReadonlyArray<T>`に限定する。

External arrayをnative `List`へ暗黙変換しない。`any`、`unknown`、unsupported collection、またはunresolved、stale、partial、ambiguousなprovider evidenceはfail closedとする。

External arrayでは、1回のrepetition evaluationにつきinitial `length`を正確に1回観測する。その観測済みlengthまでindex 0から順にvisitし、sparse-array holeはskipし、visitしたelementは各1回だけreadする。checkerはemission前にprovider-independentなrepetition evidenceを確定し、emitterはTypeScriptを再照会せず、display textやpackage/framework heuristicからarray semanticsを推測しない。

Generic `Iterable`、`AsyncIterable`、`Set`、`Map`、arbitrary array-likeはこの初期contractの対象外である。

## `[frontend.view-repetition-children]` Repetition child boundary

compiler-managed standalone `children` slotは、nested View conditionalやnested repetitionを経由する場合も含め、repetition subtree内のどこにあってもrejectする。repetitionは`break`、`continue`、assignment、imperative loop-body semanticsを導入しない。

## `[frontend.framework-neutral]` Framework-neutral core

component/View grammarはframeworkを選択しない。Virune Coreはframework-name enum、package-name heuristic、Virune frontend VDOM/runtime、universal state/effect/router API、property vocabulary rewrite、framework固有JSX loweringを定義しない。

External component validity、props、children、overload、generic、contextual callback typingは、projectが実際に使用するTypeScript JSX environmentとJavaScript interoperability contractを通じて証明する。unknown、stale、partial、ambiguousなJavaScript/TypeScript evidenceは引き続きfail-closedとする。