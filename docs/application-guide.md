# Build an application with Virune

[English](application-guide.md) | [日本語](application-guide_ja.md)

This guide is the task-oriented route from an empty project to a small Virune application. It describes the public Virune 1.0 workflow directly, without depending on a repository-owned showcase application.

> [!IMPORTANT]
> This guide is explanatory, not normative. The files under [`spec/`](../spec/README.md) define exact Virune 1.0 behavior. If this guide and the normative specification disagree, the specification wins.

## 1. Start with a normal project

Create a project with the public CLI:

```bash
virune init my-app
cd my-app
virune check .
virune run .
```

`virune init` creates `virune.json` and `src/main.virune`. Keep the project configuration explicit: the source directory, output directory, entry point, and target platform belong in `virune.json` rather than in hidden build assumptions.

The repository also contains [`examples/user-directory`](../examples/user-directory) as a small runnable example. It is useful as an example, but it is not a normative or canonical source for this guide.

See the [CLI reference](cli-reference.md) for exact command syntax and the [entry-point specification](../spec/entry-point.md) for accepted executable signatures.

## 2. Model the domain before infrastructure

Use nominal and explicit data modeling for application concepts:

- use `newtype` when two values share a representation but must not be interchangeable;
- use `record` for named domain data;
- use `enum` for closed alternatives and domain failures;
- use `Option<T>` or `T?` for explicit absence;
- use `Result<T, E>` for failures that belong in the function contract;
- use `match` to handle `Option`, `Result`, and enum variants explicitly.

Keep construction and validation close to the module that owns a nominal type. Prefer narrow public functions over exposing internal construction details merely to make another module convenient.

Collections such as `List`, `Map`, and `Set` can remain in the domain layer when they describe data rather than I/O. Their exact APIs are documented in the [standard library guide](standard-library.md).

For the exact type and visibility rules, see [types](../spec/types.md), [evaluation](../spec/evaluation.md), and [modules](../spec/modules.md). The [language guide](language-guide.md) provides a broader introduction with validated examples.

## 3. Keep effects at dependency boundaries

Observable operations should remain visible in function signatures. For example, a command-line entry point that prints output declares `uses Console`; pure domain transformations do not need to acquire `Console` merely because a higher layer prints their results.

A practical layering rule is:

1. keep domain transformations pure where possible;
2. pass ordinary typed data across module and function boundaries;
3. declare built-in effects on the functions that actually perform those effects;
4. let higher layers orchestrate I/O while lower layers expose narrow typed contracts.

This pattern does not require a Virune-specific dependency-injection framework. The important property is that dependencies and effects do not disappear into hidden globals.

The normative effect and call-compatibility rules are in [types](../spec/types.md) and [evaluation](../spec/evaluation.md).

## 4. Structure asynchronous work and cleanup

Use Virune's structured constructs instead of replacing them with detached JavaScript promises or ad-hoc cleanup:

- `async fn` declares asynchronous operations;
- `parallel` and `parallel try` group child work structurally;
- `await` waits for task results;
- postfix `?` propagates `Result` failure;
- `defer` attaches deterministic cleanup to lexical scope.

The key design property is ownership. Child work remains attached to the structured operation that created it, and cleanup remains attached to the scope that registered it.

See [tasks](../spec/tasks.md) for task, cancellation, and structured-concurrency semantics, and [evaluation](../spec/evaluation.md) for cleanup and evaluation order.

## 5. Choose the narrowest JavaScript interoperability boundary

Do not move an API to a weaker boundary merely because it is convenient. Start with the narrowest boundary that can represent the external contract faithfully.

### Generated binding

Use `virune bind` when a TypeScript declaration can be represented conservatively:

```bash
virune bind ./types/example.d.ts \
  --module example-package \
  --out src/ffi/example.virune
```

Unsupported or unsafe TypeScript shapes remain `Unknown` with diagnostics. Generated bindings are reviewable source; they are not automatically trusted simply because they were generated.

### TypeScript adapter

Use a `*.interop.ts` adapter when a JavaScript or TypeScript API should be reshaped before crossing the Virune Interop ABI:

```bash
virune interop init example-package
virune interop check .
```

Keep the adapter narrow and explicit. It should expose the boundary Virune actually consumes rather than reproducing a whole dependency API.

### Isolated unsafe FFI

Use `unsafe extern` only when the safety contract cannot be represented through the safer paths and the boundary has been explicitly audited. Raw unsafe externs belong in an `unsafe module` under the project's `ffi/` boundary. Normal application code should call only the reviewed facade.

For the practical model, see [JavaScript and TypeScript interoperability](js-interop.md). Exact boundary rules are normative in [JavaScript FFI](../spec/ffi.md) and the [JavaScript interop specification](../spec/js-interop.md).

## 6. Keep Node.js and browser targets explicit

Do not hide incompatible platform assumptions behind one project configuration. When an application has distinct Node.js and browser entry points, keep separate project roots or configurations with the appropriate `platform` value.

Platform-specific dependencies belong behind the matching boundary. A shared module should not silently depend on Node-only or browser-only behavior.

When JavaScript needs to call a Virune function directly, use the supported `@jsExport` boundary rather than relying on emitted implementation details.

Exact platform and module rules are defined by [modules](../spec/modules.md), JavaScript export rules by [JavaScript FFI](../spec/ffi.md), and executable entry rules by [entry points](../spec/entry-point.md).

## 7. Use a repeatable verification loop

Run the public CLI over the project instead of relying on a special repository showcase gate:

```bash
virune fmt --check .
virune check .
virune test .
virune build .
virune run .
```

If the project publishes a Virune API, create a deterministic snapshot once and then check it in later verification:

```bash
virune api . --out virune.api.json
virune api . --out virune.api.json --check
```

If the project contains TypeScript adapters, also run:

```bash
virune interop check .
```

Regenerate checked-in bindings when their TypeScript declarations or dependencies change and review the resulting diff. CI should invoke the same public commands that developers can reproduce locally.

The [CLI reference](cli-reference.md) is the source for exact command syntax.

## Normative specification vs. this guide

| Question | Use |
|---|---|
| How should I structure a normal application? | This guide |
| What is the exact type/effect rule? | [`spec/types.md`](../spec/types.md) |
| What is the exact evaluation/cleanup rule? | [`spec/evaluation.md`](../spec/evaluation.md) |
| What are the exact async/task rules? | [`spec/tasks.md`](../spec/tasks.md) |
| What is allowed at a JavaScript boundary? | [`spec/ffi.md`](../spec/ffi.md) and [`spec/js-interop.md`](../spec/js-interop.md) |
| What is allowed across modules/platforms? | [`spec/modules.md`](../spec/modules.md) |
| What makes a valid executable entry point? | [`spec/entry-point.md`](../spec/entry-point.md) |
| What is the exact CLI syntax? | [CLI reference](cli-reference.md) |

Use this guide to choose an application structure and the normative specification to resolve exact behavior.

## Where to go next

- Use [`examples/user-directory`](../examples/user-directory) for a small runnable application.
- Use the [language guide](language-guide.md) for a broader syntax-and-semantics introduction.
- Use the [JavaScript interop guide](js-interop.md) when designing a foreign boundary.
- Use the [CLI reference](cli-reference.md) for command behavior and options.
- Use the [normative specification index](../spec/README.md) when a compatibility or correctness decision depends on exact Virune 1.0 behavior.
