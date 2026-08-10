# Build an application with Virune

[English](application-guide.md) | [日本語](application-guide_ja.md)

This guide is the task-oriented route from an empty project to a small Virune application. It explains how the public Virune 1.0 features fit together in practice by pointing directly at the repository-owned [feature showcase](../examples/feature-showcase/README.md).

The showcase is the canonical executable source for this guide. This document intentionally does not copy its Virune source into separate snippets: when the example changes, there should be one source to review and verify.

> [!IMPORTANT]
> This guide is explanatory, not normative. The files under [`spec/`](../spec/README.md) define exact Virune 1.0 behavior. If this guide and the normative specification disagree, the specification wins.

## The application path

A practical Virune application can be built in six steps:

1. model the domain with nominal data and explicit absence/failure;
2. keep effects at dependency boundaries;
3. structure asynchronous work and cleanup;
4. choose the narrowest JavaScript interoperability tier that fits;
5. separate Node.js and browser targets explicitly;
6. run the same format, check, test, API, build, and execution loop continuously.

The feature showcase uses a small user-directory scenario so these concerns are visible in one application instead of isolated syntax examples.

## 1. Model the domain first

Start with [`examples/feature-showcase/node/src/domain.virune`](../examples/feature-showcase/node/src/domain.virune).

The file demonstrates the main domain-modeling choices together:

- `newtype UserId = Int` gives the identifier nominal identity instead of treating every integer as interchangeable;
- `record User` groups the domain data;
- `enum DirectoryError` makes the application failure cases explicit;
- `String?` represents optional email data through `Option<String>` rather than an implicit nullable value;
- `Result<User, DirectoryError>` keeps validation failure in the function contract;
- `match` handles `Option` and `Result` explicitly.

Keep construction and validation close to the module that owns a nominal type. The showcase exposes `createUserFromInt` rather than leaking the private nominal constructor across the module boundary.

Collections belong to the same domain layer when they describe data rather than effects. [`collections.virune`](../examples/feature-showcase/node/src/collections.virune) shows `List`, `Map`, and `Set` without introducing I/O.

For exact rules, see the normative [type system](../spec/types.md), [evaluation rules](../spec/evaluation.md), and [module rules](../spec/modules.md). For a broader learning-oriented explanation, see the [language guide](language-guide.md).

## 2. Put effects at dependency boundaries

Open [`examples/feature-showcase/node/src/main.virune`](../examples/feature-showcase/node/src/main.virune) next.

The executable `main` function declares `uses Console`, because printing is an observable side effect. The domain and collection functions do not declare `Console`; they receive ordinary values and return ordinary values or explicit `Result`s.

This is the practical dependency-boundary pattern in Virune:

- keep domain transformations pure where possible;
- pass data across module/function boundaries instead of hiding dependencies in globals;
- declare built-in effects with `uses` at the functions that actually require them;
- let higher layers orchestrate effectful work while lower layers expose narrow typed contracts.

Virune does not require a dependency-injection framework for this pattern. The important property is that dependencies and effects remain visible in signatures and module boundaries.

The exact effect and call-compatibility rules are normative in [types](../spec/types.md) and [evaluation](../spec/evaluation.md).

## 3. Structure asynchronous work and cleanup

[`examples/feature-showcase/node/src/workflow.virune`](../examples/feature-showcase/node/src/workflow.virune) is the canonical concurrency example.

Read it in this order:

1. `async fn` marks operations that complete asynchronously;
2. `parallel try` starts independent operations as one structured group;
3. `await` waits for the group result;
4. postfix `?` propagates the `Result` failure instead of adding an unchecked exception path;
5. `defer` registers deterministic cleanup for the scope.

The important design property is ownership: asynchronous child work stays attached to the structured operation that created it, and cleanup remains attached to lexical scope. Do not replace those guarantees with detached JavaScript promises or ad-hoc cleanup when Virune has a structured construct for the job.

Exact task and cancellation semantics are defined by the normative [task rules](../spec/tasks.md). Cleanup and evaluation order are defined by [evaluation rules](../spec/evaluation.md).

## 4. Choose a JavaScript interoperability tier

Use the narrowest boundary that can represent the JavaScript API safely. The showcase contains all three tiers.

### Tier 1: generated safe binding

- Declaration input: [`node/types/node-os-showcase.d.ts`](../examples/feature-showcase/node/types/node-os-showcase.d.ts)
- Generated Virune binding: [`node/src/ffi/node-os.virune`](../examples/feature-showcase/node/src/ffi/node-os.virune)

Use `virune bind` when the TypeScript surface can be represented conservatively and validated at runtime. Unsupported shapes must remain `Unknown` or require a different tier; do not guess a stronger Virune type.

### Tier 2: TypeScript adapter

- Adapter: [`node/src/interop/read-file.interop.ts`](../examples/feature-showcase/node/src/interop/read-file.interop.ts)

Use an adapter when a JavaScript/TypeScript API has a shape that should not cross the Virune Interop ABI directly. The showcase keeps Node's callback-style `readFile` contract inside TypeScript and exports a monomorphic callback-free `Promise<string>` boundary.

### Tier 3: isolated unsafe FFI

- Audited source fixture: [`node/src/ffi/unsafe-hostname.virune.example`](../examples/feature-showcase/node/src/ffi/unsafe-hostname.virune.example)

Use `unsafe extern` only when the safety contract cannot be expressed through the safe tiers and the boundary has been explicitly audited. The raw extern belongs inside an `unsafe module` under the project's `ffi/` boundary, with normal application code calling only the reviewed facade.

The `.virune.example` suffix in the repository showcase is deliberate. A repository-root scan and a nested project's `src/ffi/` use different source roots; keeping the fixture non-discoverable preserves the root unsafe-path rule. Issue #81 owns staging this fixture into the showcase project's own `src/ffi/` context for continuous project-scoped validation.

For the practical interoperability model, see [JavaScript and TypeScript interoperability](js-interop.md). Exact boundary rules are normative in [JavaScript FFI](../spec/ffi.md) and the [three-tier interop specification](../spec/js-interop.md).

## 5. Keep Node.js and browser targets separate

The showcase has two project configurations instead of one configuration with hidden platform assumptions:

- Node.js: [`examples/feature-showcase/node/virune.json`](../examples/feature-showcase/node/virune.json)
- Browser: [`examples/feature-showcase/browser/virune.json`](../examples/feature-showcase/browser/virune.json)

The Node project owns the executable CLI scenario, Node interoperability, tests, and public API snapshot. The browser project owns a browser-target build and an [`@jsExport` boundary](../examples/feature-showcase/browser/src/main.virune).

Keep platform-specific dependencies behind the matching project boundary. Do not make a shared module silently depend on Node-only or browser-only behavior.

Exact platform/module rules are defined by [modules](../spec/modules.md), and executable entry rules are defined by [entry points](../spec/entry-point.md).

## 6. Use one verification loop

From a Virune repository clone, build the toolchain first and run the same public commands against the showcase:

```bash
npm run virune -- fmt --check examples/feature-showcase/node
npm run virune -- check examples/feature-showcase/node
npm run virune -- test examples/feature-showcase/node
npm run virune -- api examples/feature-showcase/node \
  --out examples/feature-showcase/node/virune.api.json --check
npm run virune -- build examples/feature-showcase/node
npm run virune -- run examples/feature-showcase/node -- Alice Bob

npm run virune -- fmt --check examples/feature-showcase/browser
npm run virune -- check examples/feature-showcase/browser
npm run virune -- build examples/feature-showcase/browser
```

Regenerate the safe binding from its checked-in declaration fixture with:

```bash
npm run virune -- bind \
  examples/feature-showcase/node/types/node-os-showcase.d.ts \
  --module node:os \
  --out examples/feature-showcase/node/src/ffi/node-os.virune
```

Validate TypeScript adapters with:

```bash
npm run virune -- interop check examples/feature-showcase/node
```

When using an installed Virune CLI in your own project, use the corresponding `virune` commands directly. A project created by `virune init` also provides the common npm scripts shown in its generated README.

The checked-in [`virune.api.json`](../examples/feature-showcase/node/virune.api.json) is part of the contract: `api --check` detects public-surface drift rather than silently rewriting the snapshot.

Issue #81 is responsible for turning this complete showcase loop—including real browser execution, generated-output drift, and project-scoped unsafe FFI validation—into a continuous Pull Request quality gate. This guide does not claim that follow-up is already complete.

## Normative specification vs. this guide

| Question | Use |
|---|---|
| How should I structure a normal application? | This guide and the feature showcase |
| What is the exact type/effect rule? | [`spec/types.md`](../spec/types.md) |
| What is the exact evaluation/cleanup rule? | [`spec/evaluation.md`](../spec/evaluation.md) |
| What are the exact async/task rules? | [`spec/tasks.md`](../spec/tasks.md) |
| What is allowed at a JavaScript boundary? | [`spec/ffi.md`](../spec/ffi.md) and [`spec/js-interop.md`](../spec/js-interop.md) |
| What is allowed across modules/platforms? | [`spec/modules.md`](../spec/modules.md) |
| What makes a valid executable entry point? | [`spec/entry-point.md`](../spec/entry-point.md) |

Use the guide to choose a design and the normative specification to resolve exact behavior.

## Traceability to the canonical showcase

| Task | Canonical source | Exact rules |
|---|---|---|
| Domain modeling | [`domain.virune`](../examples/feature-showcase/node/src/domain.virune) | [`types.md`](../spec/types.md), [`evaluation.md`](../spec/evaluation.md) |
| Collections | [`collections.virune`](../examples/feature-showcase/node/src/collections.virune) | [`standard-library.md`](../spec/standard-library.md) |
| Effects / executable boundary | [`main.virune`](../examples/feature-showcase/node/src/main.virune) | [`types.md`](../spec/types.md), [`entry-point.md`](../spec/entry-point.md) |
| Structured concurrency / cleanup | [`workflow.virune`](../examples/feature-showcase/node/src/workflow.virune) | [`tasks.md`](../spec/tasks.md), [`evaluation.md`](../spec/evaluation.md) |
| Virune-native tests | [`showcase.spec.virune`](../examples/feature-showcase/node/src/showcase.spec.virune) | [Language guide](language-guide.md) |
| Public API snapshot | [`virune.api.json`](../examples/feature-showcase/node/virune.api.json) | [CLI reference](cli-reference.md) |
| Safe binding | [`node-os.virune`](../examples/feature-showcase/node/src/ffi/node-os.virune) | [`ffi.md`](../spec/ffi.md) |
| TypeScript adapter | [`read-file.interop.ts`](../examples/feature-showcase/node/src/interop/read-file.interop.ts) | [`js-interop.md`](../spec/js-interop.md) |
| Isolated unsafe FFI | [`unsafe-hostname.virune.example`](../examples/feature-showcase/node/src/ffi/unsafe-hostname.virune.example) | [`ffi.md`](../spec/ffi.md) |
| Node/browser split | [`node/virune.json`](../examples/feature-showcase/node/virune.json), [`browser/virune.json`](../examples/feature-showcase/browser/virune.json) | [`modules.md`](../spec/modules.md) |

## Where to go next

- Use the [feature showcase README](../examples/feature-showcase/README.md) when you want the exact runnable commands and file layout.
- Use the [language guide](language-guide.md) when you want a broader syntax-and-semantics introduction.
- Use the [JavaScript interop guide](js-interop.md) when you need to design a foreign boundary in more detail.
- Use the [normative specification index](../spec/README.md) when a compatibility or correctness decision depends on exact Virune 1.0 behavior.
