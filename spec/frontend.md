# Frontend Component and View Authoring

[日本語版](frontend_ja.md)

This document defines the Virune-native frontend authoring surface. It defines source and language semantics only; framework-specific rendering, reactivity, JSX transformation, component libraries, routers, CSS, HMR, and bundling remain owned by the downstream JavaScript ecosystem.

## `[frontend.component-declaration]` Component declarations

A `component` declaration is a frontend host-invoked boundary and is distinct from an ordinary Virune `fn`.

```virune
internal component UserPage(user: User) uses JavaScript {
    return view {
        main(className: "page") {
            { user.name }
        }
    }
}
```

A component has ordinary typed parameters and a required `uses` clause, but it has no type-parameter list, `async` modifier, expression body, or written return type. A component is not an ordinary Virune callable value and cannot be invoked through ordinary call syntax.

## `[frontend.component-visibility]` Component visibility

A component is module-private by default. `internal component` uses the package/application scope defined by `[module.visibility]` and may be imported by another Virune module in the same known scope.

Virune 1.0 does not define a stable published `pub component` ABI. A `pub component` declaration is rejected rather than being treated as an ordinary published function or as a JavaScript export shortcut.

## `[frontend.component-effects]` Component effects

A component must explicitly declare the `JavaScript` effect because the frontend host and JSX boundary are JavaScript-owned. Additional concrete effects may be declared normally.

The component form does not create a second frontend effect system and does not weaken ordinary effect checking.

## `[frontend.view-containment]` Non-nameable View results

`view` produces a compiler-controlled, non-nameable View result. Virune does not define a source-level `View` type and does not classify a View result as `Unknown` or a general `External` value.

A View result may be consumed only as:

- the direct return value of a `component`;
- nested View child structure;
- a View-local declarative conditional branch; or
- the compiler-managed native-component child slot defined below.

A View result cannot be stored in `let`/`const`, records, lists, tuples, or other ordinary values; passed to an ordinary call; exported as an ordinary API value; field- or index-accessed; projected to a general External value; or returned from an ordinary `fn`.

Every returning path of a component must directly return View structure. A non-View return or a component path that completes without a View return is rejected.

## `[frontend.view-elements]` Elements and component references

A View element uses an identifier or dotted identifier/member path as its tag spelling:

```virune
view {
    main()
    ui.Button()
}
```

The parser does not classify a tag as React, Preact, Solid, Vue, an intrinsic element, or a third-party component. Framework/library validity is determined later from the project's actual TypeScript JSX environment.

An element may be empty or own a nested View block. Multiple root children are valid and represent fragment-equivalent output; Virune does not require a wrapper element solely to satisfy the authoring grammar.

## `[frontend.view-properties]` Properties

View properties map a property name to an ordinary Virune expression:

```virune
Button(onClick: logout, "data-state": state) {
    "Logout"
}
```

A property name may be an ordinary identifier name or a quoted string for names that are not representable as ordinary Virune identifiers. Virune does not rewrite framework vocabulary such as `class` to `className` and does not define framework-specific directive syntax.

Property expressions remain ordinary Virune expressions and do not gain View or External escape semantics merely because they occur in a View.

## `[frontend.view-children]` Text and expression children

A string literal is a text child. An ordinary Virune expression becomes an expression child when enclosed by `{` and `}` in View-child position:

```virune
view {
    p() {
        "User: "
        { user.name }
    }
}
```

The braces are contextual View authoring delimiters, not a general change to Virune expression syntax. The expression inside them follows ordinary Virune expression semantics and remains subject to the normal effect and JavaScript-boundary rules. A leading `= expression` is not a View expression-child form.

## `[frontend.view-conditional]` Declarative View conditionals

A View-local `if` is a dedicated declarative View construct:

```virune
view {
    if loggedIn {
        Dashboard()
    } else {
        Login()
    }
}
```

Its condition is an ordinary Virune expression. The branches are View blocks. If `else` is omitted and the condition is false, the conditional contributes zero View children. That absence is fragment-equivalent structural output; Virune does not evaluate or synthesize a fallback value.

The compiler must preserve the conditional's source/evaluation position for downstream frontend processing, including the no-`else` absence branch. It must not eagerly hoist, snapshot, or cache the conditional or host-sensitive branch expressions in a way that changes framework-owned reactivity or laziness.

The empty fragment introduced for a no-`else` absence branch must not be used when it would become an observable child of a JavaScript-imported External component. Until zero-child absence can be preserved at that boundary without changing the downstream component's children/slot semantics, a no-`else` conditional in that direct External child structure is rejected rather than guessed into success.

## `[frontend.children-slot]` Compiler-managed native children slot

Inside View structure, standalone `children` denotes the compiler-managed child slot of the current Virune-native component:

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

The slot spelling is contextual rather than globally reserved. Outside the exact standalone View-child form, `children` remains a valid ordinary Virune identifier, including parameter, local, field, and expression names. Only standalone `children` in View-child position denotes the compiler-managed slot.

That slot is not an ordinary parameter, callable, External value, React `props.children`, Vue slot object, Solid accessor, or other framework-specific API. In Virune 1.0, a component may place the slot at most once; duplicate placement is rejected so the language does not invent repeated-evaluation/laziness semantics that differ across frameworks.

The eventual compiler-owned transport/lowering must preserve the source evaluation and laziness required by the actual frontend framework without exposing a general View value.

The compiler-managed slot must not become an observable direct child value of a JavaScript-imported External component. Until its zero-or-more child contribution can be preserved at that boundary without changing downstream children/slot semantics, standalone `children` in that direct External child structure is rejected. A slot nested beneath an intrinsic element below an External component remains eligible for ordinary View validation.

## `[frontend.framework-neutral]` Framework-neutral core

The component/View grammar does not select a framework. Virune Core does not define framework-name enums, package-name heuristics, a Virune frontend VDOM/runtime, universal state/effect/router APIs, property-vocabulary rewrites, framework-specific JSX lowering, or framework-neutral list reconciliation. Virune 1.0 does not define a View-local repetition construct; list rendering that depends on identity or lifecycle remains owned by downstream framework/library APIs consumed through ordinary External JSX/API interoperability.

External component validity, props, children, overloads, generics, and contextual callback typing are proven through the project's actual TypeScript JSX environment and the JavaScript interoperability contract. Unknown, stale, partial, or ambiguous JavaScript/TypeScript evidence remains fail-closed.
