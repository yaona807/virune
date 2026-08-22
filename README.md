<p align="center">
  <img src="assets/virune-logo.svg" alt="Virune" width="520">
</p>

<h1 align="center">Virune</h1>

<p align="center">
  A statically typed programming language for writing simpler, more predictable code<br>
  while keeping access to the JavaScript ecosystem.
</p>

<p align="center">
  <a href="https://github.com/yaona807/virune/actions/workflows/ci.yml"><img src="https://github.com/yaona807/virune/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI"></a>
  <a href="https://github.com/yaona807/virune/releases"><img src="https://img.shields.io/github/v/release/yaona807/virune?display_name=tag&sort=semver" alt="Latest release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/yaona807/virune" alt="License"></a>
</p>

<p align="center">
  <a href="spec/README.md">Language specification</a> ·
  <a href="CONTRIBUTING.md">Contributing</a> ·
  <a href="COMPATIBILITY.md">Compatibility</a> ·
  <a href="SECURITY.md">Security</a> ·
  <a href="README_ja.md">日本語</a>
</p>

## Why Virune exists

One of the biggest strengths of JavaScript and TypeScript is the ecosystem that has grown around them. Virune is not trying to discard that ecosystem and build a separate world.

At the same time, JavaScript brings concepts such as `null` and `undefined`, dynamic external values, exceptions, and Promise-based concurrency that applications need to account for.

TypeScript makes these values much safer to work with while preserving JavaScript compatibility. It does not, however, replace JavaScript's runtime model.

Virune therefore focuses on **handling the complexity required at JavaScript boundaries without spreading more of it than necessary into ordinary application code**.

It also tries to make more than value types visible in code. Recoverable failure, effects, and the behavior of concurrent work should be understandable from declarations wherever practical.

Keep the JavaScript ecosystem. Keep everyday code as simple as possible. That is the basic idea behind Virune.

## Consider the same problem in TypeScript

Suppose an application loads a user and their orders from APIs, then prints the user's display name and order count.

In the example below, `loadUser` and `loadOrders` are existing API-client functions whose Promises reject when the request fails.

```typescript
type User = {
  name: string;
  nickname?: string | null;
};

type Order = {
  id: string;
};

async function showDashboard(userId: string): Promise<void> {
  const [user, orders] = await Promise.all([
    loadUser(userId),
    loadOrders(userId),
  ]);

  const displayName = user.nickname ?? user.name;

  console.log(`${displayName}: ${orders.length} orders`);
}
```

This is ordinary TypeScript. It is concise, readable, and sufficient for many applications.

Looking more closely, however, some information is not visible from the function declaration alone.

### Absence has multiple representations

For the `nickname` property above, a reader must account for a `string`, `null`, or `undefined` caused by an absent property.

TypeScript tracks these states in the type system. But when the application only needs to know whether a nickname exists, carrying the distinction between `null` and `undefined` through ordinary code may not be useful.

### Failure is not part of the return type

From its type, `showDashboard` is `(userId: string) => Promise<void>`.

That tells us the function is asynchronous, but it does not describe how `loadUser` or `loadOrders` may fail. TypeScript applications can introduce Result types or their own error conventions.

Virune includes recoverable failure as the ordinary `Result<T, E>` model.

### Effects are not part of the function declaration

The `showDashboard` function above uses the network and writes to standard output, but those effects are not represented in its function type.

Virune declares such effects with `uses`.

### Concurrency lifetime is a separate design choice

The example above uses `Promise.all()` to run two operations concurrently.

If either Promise rejects, `Promise.all()` rejects as well, but it does not automatically stop another operation that has already started. When cancellation is needed, JavaScript code can combine APIs such as `AbortController` with the underlying operation.

Virune defines the lifetime and failure behavior of concurrently started work through structured concurrency in the language and Runtime.

## The same code in Virune

The same operation can be expressed in Virune as follows.

Here, assume `loadUser` and `loadOrders` are asynchronous operations that both use `DashboardError` as their recoverable error type.

```virune
record User {
    name: String
    nickname: String?
}

record Order {
    id: String
}

enum DashboardError {
    UserLoadFailed
    OrderLoadFailed
}

async fn showDashboard(
    userId: String
) -> Result<Unit, DashboardError> uses Network, Task, Console {
    let values = await (parallel try {
        user: loadUser(userId)
        orders: loadOrders(userId)
    })?

    let displayName = match values.user.nickname {
        Some(nickname) => nickname
        None => values.user.name
    }

    Console.print("{displayName}: {List.length(values.orders)} orders")
    return Ok(Unit)
}
```

The operation is similar to the TypeScript version above, but information about its behavior is also present in its declarations.

### Absence uses `Option`

The `nickname: String?` declaration below is the short form of `Option<String>`.

Ordinary Virune values are not `null` or `undefined`. An optional value is explicitly `Some` or `None`.

### Failure is visible in `Result`

The return type below makes it clear that the operation can fail with `DashboardError`.

```virune
-> Result<Unit, DashboardError>
```

The `?` operator propagates a compatible recoverable failure to the caller.

### Effects are visible in `uses`

The declaration below shows that the function uses network access, tasks, and standard output.

```virune
uses Network, Task, Console
```

A reader does not need to inspect the entire implementation just to identify these categories of effects.

### Concurrent work has a defined lifetime

The following block starts both operations concurrently.

```virune
parallel try {
    user: loadUser(userId)
    orders: loadOrders(userId)
}
```

If one operation returns `Err`, cancellation is signaled to its sibling and the parent waits for all child tasks to settle before continuing. Ordinary Virune code has no detached tasks.

This is not a claim that TypeScript cannot implement these patterns. Some concerns that TypeScript leaves to libraries or project-level design are common language rules in Virune.

## The JavaScript boundary

Virune is not isolated from the JavaScript ecosystem.

JavaScript APIs that can be handled safely from their type information can be imported with `import js`.

```virune
import js { nanoid } from "nanoid"
```

Virune does not treat every value arriving from JavaScript as a trusted native value.

TypeScript `any` is not accepted as a safe type, and `unknown` is not silently narrowed to a more convenient type. Values that cannot be safely determined remain `Unknown` until they are handled explicitly.

More complex TypeScript APIs can use an Adapter so that JavaScript-side complexity remains separate from ordinary Virune code. The same principle applies to `null` and `undefined`: their distinctions are handled where the boundary requires them instead of becoming ordinary Virune values.

Virune also cannot guarantee that an external library's implementation actually follows its type declarations. What can be checked at the boundary and what remains part of the dependency's trust boundary are kept separate.

**The goal is not to pretend JavaScript's complexity does not exist. It is to make clear where that complexity is handled.**

## Keep the language no larger than necessary

Virune does not assume that adding more language features always produces a better language.

When existing small features can be combined to express the same idea clearly, Virune avoids adding a dedicated syntax or mechanism only for that use case.

For example, Virune 1.0 has no classes or inheritance. Data can be expressed with `record` and `enum`, while values that need distinct identities can use `newtype`.

```virune
newtype UserId = Int

record User {
    id: UserId
    name: String
}

enum UserState {
    Active
    Suspended
}
```

Reusable behavior can be composed from ordinary functions and records that contain functions.

```virune
record Encoder<T> {
    encode: fn(T) -> String
}

fn serialize<T>(value: T, encoder: Encoder<T>) -> String {
    return encoder.encode(value)
}
```

The point is not to prevent advanced programs from being written.

**Advanced programs should still be possible while the language itself remains as simple as practical.** When existing pieces are enough, Virune does not add a new concept just to provide another way to express the same thing.

## Quick start

Virune 1.0.0 requires Node.js 24 or later. The current stable CLI can be installed from the published package on GitHub Releases.

```bash
npm install --global https://github.com/yaona807/virune/releases/download/v1.0.0/virune-1.0.0.tgz
virune --version
```

After installation, create and run a project with:

```bash
virune init hello-virune
cd hello-virune
virune run
```

To check types and project configuration without emitting JavaScript, run:

```bash
virune check
```

To emit ES2022 JavaScript, run:

```bash
virune build
```

When no path is given, `check`, `run`, and `build` operate on the current directory.

## Main language features

Virune 1.0 includes:

- static typing and type inference
- `record`, `enum`, and `newtype`
- `Option` and `Result`
- exhaustive pattern matching
- explicit effects with `uses`
- `async` / `await`
- structured concurrency with `parallel` / `parallel try`
- cleanup with `defer`
- generics
- JavaScript interoperability
- ES2022 ESM output
- CLI, Language Server, VS Code extension, and formatter

## Current status

Virune 1.0 provides the core language, compiler, Runtime, standard library, CLI, editor integration, and the foundation for JavaScript interoperability.

Current development is expanding the range of real JavaScript and TypeScript libraries that can be used naturally from Virune.

Stable and experimental surfaces are kept separate. See the [compatibility policy](COMPATIBILITY.md) for the compatibility model.

## Documentation

- [Language specification](spec/README.md)
- [Compatibility policy](COMPATIBILITY.md)
- [Contributing](CONTRIBUTING.md)
- [Security policy](SECURITY.md)

## Contributing

Issues and Pull Requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, tests, and the rules that apply when changing the language specification or public API / ABI.

## Governance

Virune is currently maintained by [`@yaona807`](https://github.com/yaona807). There is currently no steering committee or voting process.

Changes and proposals are generally developed publicly through Issues and Pull Requests, and final project decisions are made by the maintainer. Security reports follow [SECURITY.md](SECURITY.md).

## Releases

Published stable, prerelease, and Nightly builds are available from [GitHub Releases](https://github.com/yaona807/virune/releases).

GitHub Releases are an official distribution channel, and published artifacts are not later replaced with different contents. Release eligibility is verified by repository-owned machine-readable policy and CI.

## License

Virune is licensed under the [Apache License 2.0](LICENSE). See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for third-party software notices.
