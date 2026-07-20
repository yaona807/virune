# Virune

Virune is a statically typed application language that compiles to readable ES2022 modules.
It targets Node.js and browsers while keeping JavaScript and TypeScript interoperability explicit and validated.

Current version: **1.0.0**
Minimum Node.js version: **24**

[日本語](README_ja.md)

## Design goals

Virune is designed around four constraints:

- easy to learn;
- predictable, readable syntax;
- deliberately limited freedom;
- strong static and boundary safety.

The language keeps a small set of orthogonal primitives. Higher-level behaviour is composed from functions, records, enums, generics, and standard-library modules rather than protocols, classes, macros, or implicit implementation lookup.

## Core characteristics

- nominal `record`, `enum`, and `newtype` declarations;
- transparent `type` aliases;
- explicit `Option` and `Result` values with postfix `?` propagation;
- exhaustive pattern matching;
- immutable native values by default;
- fixed built-in effect signatures through `uses`;
- non-escaping open callback effects through `uses *`;
- structured concurrency through `async`, `await`, `parallel`, and `parallel try`;
- deterministic cleanup through `defer`;
- structural equality and hashing that user code cannot redefine;
- validated JavaScript boundaries with conservative `Unknown` fallback;
- ESM output, source maps, formatter, LSP, VS Code extension, conformance suite, and release tooling.

Virune intentionally does not provide classes, inheritance, exceptions for recoverable errors, macros, operator overloading, user-defined protocols, user-defined capability names, implicit nullable values, or unchecked casts in normal code.

## Example

```virune
pub newtype UserId = Int

type UserLookup = fn(UserId) -> Result<User, UserError>

pub record User derives Eq, Hash, Debug, Json {
	id: UserId
	name: String
	nickname: String?
}

pub enum UserError derives Eq, Debug, Json {
	NotFound(UserId)
	InvalidName(String)
}

fn display(user: User) -> String {
	let nickname = match user.nickname {
		Some(value) => value
		None => "not set"
	}
	return "{user.name} ({nickname})"
}

pub fn main(args: List<String>) -> Result<Unit, UserError> uses Console {
	let user = User {
		id: UserId.create(1)
		name: "Alice"
		nickname: None
	}
	Console.print(display(user))
	Console.print("argument count: {List.length(args)}")
	return Ok(Unit)
}
```

## Repository layout

- `packages/compiler` — lexer, parser, checker, project graph, emitter, public compiler API;
- `packages/runtime` — Runtime ABI v2 and native value operations;
- `packages/stdlib` — Node.js and browser adapters;
- `packages/formatter` — canonical source formatter;
- `packages/language-server` — LSP implementation;
- `packages/vscode` — syntax highlighting and bundled language server;
- `packages/js-interop` — TypeScript adapter validation;
- `packages/cli` — project, binding, formatting, testing, and conformance commands;
- `spec` — normative language specification;
- `conformance` — exact diagnostic fixtures;
- `corpus` — JavaScript and TypeScript interoperability corpus.

## Build from a clone

```bash
npm ci
npm run verify
```

`npm run verify` checks the required Node.js runtime, public package registry, release channel, compiler API, TypeScript build, unit and integration tests, fuzz smoke tests, VS Code and LSP tests, conformance fixtures, formatter output, normative specification, grammar, and clean-clone behaviour.

## CLI

```bash
npm run virune -- init path/to/project
npm run virune -- check path/to/project
npm run virune -- build path/to/project
npm run virune -- run path/to/project -- argument
npm run virune -- fmt path/to/project
npm run virune -- bind package-or-file.d.ts
```

## JavaScript and TypeScript interoperability

Virune distinguishes native imports from JavaScript imports:

```virune
import { User } from "./user.virune"
import js { nanoid } from "nanoid"
import js axios from "axios"
import js * as fs from "node:fs/promises"
import js "./polyfill.js"
```

Safe FFI accepts only types that can be completely validated at runtime. Unsupported callbacks, unresolved generics, recursive aggregates, TypeScript `Record<K, V>`, and identity-sensitive object-keyed maps or sets fall back to `Unknown` or require a TypeScript adapter.

See [JavaScript interoperability](docs/js-interop.md) and [the normative specification](spec/README.md).

## Release status

Virune 1.0.0 is the first stable release target. Semantic Versioning applies to the documented stable APIs and language specification. Runtime ABI v2 and Interop ABI v2 are the canonical ABIs for 1.0.0. Release gates are documented in [docs/stable-release-gate.md](docs/stable-release-gate.md).

## License

MIT. See [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
