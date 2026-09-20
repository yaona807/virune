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
- a View-local declarative conditional or repetition body; or
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

## `[frontend.view-repetition]` Declarative View repetition

A View-local `for` is a dedicated declarative View construct and is distinct from the ordinary imperative `ForStatement`. View repetition requires an explicit logical identity:

```virune
view {
    for user, index in users by user.id {
        UserRow(user: user, position: index)
    }
}
```

`by` is contextual to View repetition and remains available as an ordinary identifier elsewhere. The identity expression is evaluated after the current item and optional source-index bindings exist. Its checked type must be `String` or `Int`; unresolved or unsupported identity evidence is rejected. String and Int identities occupy distinct tagged domains. Two visited items that produce the same tagged identity in one snapshot are rejected before Host reconciliation or View-body execution.

Virune does not infer identity from the source index, transported JavaScript object identity, a child property such as `key`, a field name such as `id`, or framework/package conventions. Identity-free View repetition is not part of the stable language surface.

Identity-bearing repetition is evaluated through exactly one project-owned Repetition Host. The project declares the Host through the existing declaration-attribute and `extern js` surface:

```virune
@repetitionHost("render", 1)
extern js "./repetition-host.js" {}
```

For protocol version 1, the compiler-visible call shape is conceptually:

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

The compiler owns snapshot traversal, identity encoding, duplicate detection, safe transport/capture checks, and the Host call. The project Host and downstream framework own reconciliation, keyed representation, scheduling, lifecycle, and rendering. Callback invocation count is not a Virune guarantee.

The Host locator is project-owned. A dependency package cannot silently select the project's repetition Host. Missing, malformed, unsupported, ambiguous, or otherwise unprovable Host evidence fails closed and suppresses affected output. Relative Host modules are resolved from the locator declaration and rebased for the emitted consumer. The located export is validated through the project's current TypeScript whole-usage environment; Virune does not reimplement TypeScript function assignability or choose a framework by name.

One logical identity owns the complete View result of one iteration. If an iteration contributes multiple children, those children remain one identity-owned group for downstream reconciliation. Nested identity repetition composes through the same Host contract.

## `[frontend.view-repetition-source]` Repetition source boundary

Initial repetition sources are limited to host-safe native `List<T>` and JavaScript External `Array<T>` / `ReadonlyArray<T>` whose array and indexed-element shape is proven from the current interop provider snapshot.

External arrays are not implicitly converted to native `List`. `any`, `unknown`, unsupported collections, or unresolved, stale, partial, or ambiguous provider evidence fail closed.

For each Host-triggered `readSnapshot()` evaluation, the source expression is evaluated exactly once. An External array's initial `length` is observed exactly once; indexes are visited from zero to that observed length, sparse holes are skipped, and each visited item is read once. The optional index binding is the zero-based source index, not an output ordinal.

The source, transported item, identity expression, and View body all cross Host-deferred boundaries and therefore must satisfy the frontend lifetime/transport safety rules. Resource/capability values, raw native callables, lifetime-bound or must-use values, unresolved/open shapes, and other values whose deferred safety cannot be proven are rejected. Explicit user-authored snapshots remain ordinary Virune semantics and are not moved back into a reactive Host position.

Generic `Iterable`, `AsyncIterable`, `Set`, `Map`, and arbitrary array-like values are outside this initial contract.

## `[frontend.view-repetition-children]` Repetition child boundary

The compiler-managed standalone `children` slot is rejected anywhere inside a repetition subtree, including through nested View conditionals or nested repetitions. Repetition does not introduce `break`, `continue`, assignment, or imperative loop-body semantics.

A Host-backed repetition used as the direct child of a JavaScript-imported External component remains fail-closed until the exact Host result can be proven against that directly observable downstream children shape. Repetition nested under an intrinsic element below an External component remains eligible for normal validation. This restriction is a conservative proof boundary; it is not permission to restore compiler-owned structural array expansion or framework-specific lowering.

## `[frontend.framework-neutral]` Framework-neutral core

The component/View grammar does not select a framework. Virune Core does not define framework-name enums, package-name heuristics, a Virune frontend VDOM/runtime, universal state/effect/router APIs, property-vocabulary rewrites, or framework-specific JSX lowering.

External component validity, props, children, overloads, generics, and contextual callback typing are proven through the project's actual TypeScript JSX environment and the JavaScript interoperability contract. Unknown, stale, partial, or ambiguous JavaScript/TypeScript evidence remains fail-closed.
