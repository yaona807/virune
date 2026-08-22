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

At the same time, JavaScript brings concepts such as `null` and `undefined`, dynamic external values, exceptions, and Promises that applications need to account for. TypeScript makes these values much safer to work with, but it does not replace JavaScript's runtime model.

Virune therefore focuses on **handling the complexity required at JavaScript boundaries without spreading more of it than necessary into ordinary code**. It also tries to make recoverable failure, effects, and concurrency behavior visible from code wherever practical.

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

declare function loadUser(userId: string): Promise<User>;
declare function loadOrders(userId: string): Promise<Order[]>;

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

The code above still leaves some concerns to surrounding design:

- Reading `nickname` means accounting for a `string`, `null`, or `undefined` caused by an absent property.
- The type of `showDashboard` does not describe how `loadUser` or `loadOrders` may fail. TypeScript applications can introduce Result types or their own error conventions.
- Network access and console output are not represented in the function type.
- `Promise.all()` rejects when one input rejects, but it does not automatically stop another operation that has already started. Cancellation can be designed with APIs such as `AbortController` when the underlying operation supports it.

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
        user: loadUser(userId),
        orders: loadOrders(userId),
    })?

    let displayName = match values.user.nickname {
        Some(nickname) => nickname
        None => values.user.name
    }

    Console.print("{displayName}: {List.length(values.orders)} orders")
    return Ok(Unit)
}
```

In the code above, absence is represented with `Option`, recoverable failure with `Result`, and effects with `uses`.

Work started by `parallel try` belongs to its parent scope. If one operation returns `Err`, cancellation is signaled to its sibling and the parent waits for all child tasks to settle before continuing.

This is not a claim that TypeScript cannot implement these patterns. Some concerns that TypeScript leaves to libraries or project-level design are common language rules in Virune.

## The JavaScript boundary

Virune is not isolated from the JavaScript ecosystem. When corresponding type declarations can be interpreted safely, JavaScript APIs can be imported with `import js`.

```virune
import js { nanoid } from "nanoid"
```

Virune does not treat every value arriving from JavaScript as a trusted native value.

For ordinary `import js`, TypeScript `any` is not accepted as a safe type, and `unknown` is not silently narrowed to a more convenient type. Values that cannot be safely determined remain `Unknown` until they are handled explicitly. Values involving `null` or `undefined` are also handled at the boundary and explicitly converted into Virune-side types.

More complex TypeScript APIs can be isolated behind a TypeScript-side Adapter. Virune also cannot guarantee that an external library's implementation actually follows its type declarations.

**The goal is not to pretend JavaScript's complexity does not exist. It is to make clear where that complexity is handled.**

## Keep the language as simple as practical

Virune does not assume that more language features always produce a better language.

When existing small features can be combined to express the same idea clearly, Virune avoids adding a dedicated syntax or mechanism only for that use case.

For example, Virune 1.0 has no classes or inheritance. Data is expressed with `record` and `enum`, distinct value identities can use `newtype`, and reusable behavior can be composed from functions and records that contain functions.

The goal is not to make advanced programs impossible. **Even when advanced behavior is needed, the language itself should remain as simple as practical.** If existing pieces are enough, Virune avoids adding a new concept just to provide another way to express the same thing.

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

Use `virune check` to check types and project configuration without emitting JavaScript, and `virune build` to emit ES2022 JavaScript. When no path is given, `check`, `run`, and `build` operate on the current directory.

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

Published stable, prerelease, and nightly builds are available from [GitHub Releases](https://github.com/yaona807/virune/releases).

GitHub Releases are an official distribution channel, and published artifacts are not later replaced with different contents. Release eligibility is verified by repository-owned machine-readable policy and CI.

## License

Virune is licensed under the [Apache License 2.0](LICENSE). See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for third-party software notices.
