<p align="center">
  <img src="assets/virune-logo.svg" alt="Virune" width="520">
</p>

<h1 align="center">Virune</h1>

<p align="center">
  A statically typed programming language for the JavaScript ecosystem.<br>
  Virune compiles to readable ES2022 modules and makes absence, errors, effects, concurrency, and JavaScript boundaries explicit.
</p>

<p align="center">
  <a href="https://github.com/yaona807/virune/actions/workflows/ci.yml"><img src="https://github.com/yaona807/virune/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI"></a>
  <img src="https://img.shields.io/badge/version-1.0.0-5A54E8" alt="Version 1.0.0">
  <img src="https://img.shields.io/badge/Node.js-%3E%3D24-339933?logo=nodedotjs&logoColor=white" alt="Node.js 24 or later">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT License"></a>
</p>

<p align="center">
  <a href="#quick-start">Quick start</a> ·
  <a href="docs/language-guide.md">Language guide</a> ·
  <a href="docs/cli-reference.md">CLI reference</a> ·
  <a href="docs/vscode.md">VS Code</a> ·
  <a href="spec/README.md">Specification</a> ·
  <a href="README_ja.md">日本語</a>
</p>

> [!IMPORTANT]
> **Distribution policy:** Virune is not published to the npm Registry. Versioned npm-compatible tarballs and the VS Code VSIX are distributed through GitHub Releases. The first v1.0.0 GitHub Release has not been published yet, so use the source-based setup until that release is available.

## Why Virune?

JavaScript provides a mature runtime and package ecosystem, while TypeScript catches many mistakes during development. Runtime values, external data, and JavaScript package boundaries still require deliberate validation because TypeScript types are not present at runtime.

Languages with stronger safety guarantees often introduce a separate runtime, package manager, or deployment model. Virune takes a narrower approach: it keeps the Node.js, browser, ESM, and npm ecosystem, while moving common application risks into explicit language constructs and checked boundaries.

Virune is designed around four principles:

- **Readable by default** — predictable syntax and deterministic, inspectable ES2022 output.
- **Explicit failure** — `Option`, `Result`, `Validation`, exhaustive matching, and no implicit nullable values.
- **Controlled effects** — functions declare built-in effects with `uses`; resources use deterministic `defer` cleanup.
- **Conservative interoperability** — JavaScript and TypeScript boundaries are validated, with unsupported types falling back to `Unknown` instead of being guessed.

## What Virune provides

| Concern | Virune approach |
|---|---|
| Missing values | `Option<T>` instead of implicit `null` or `undefined` |
| Recoverable errors | `Result<T, E>`, `Validation<T, E>`, and postfix `?` propagation |
| Data modelling | Nominal `record`, `enum`, and `newtype`; transparent `type` aliases |
| Control flow | Exhaustive pattern matching with guards and structured loops |
| Side effects | Fixed built-in effect declarations through `uses` and higher-order forwarding through `uses *` |
| Concurrency | Structured `async`, `await`, `parallel`, and `parallel try` |
| Resource lifetime | Deterministic LIFO cleanup through `defer` |
| JavaScript interop | Explicit `import js`, runtime validation, TypeScript binding generation, and adapter support |
| Tooling | CLI, formatter, source maps, LSP, VS Code extension, conformance suite, fuzzing, and release checks |

Virune intentionally excludes classes, inheritance, macros, operator overloading, user-defined protocols, user-defined capability names, implicit nullable values, unchecked casts in normal code, a custom VM, and a custom package manager.

## Language example

```virune
pub newtype UserId = Int

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

## Quick start

### Requirements

- Node.js 24 or later
- npm included with Node.js

### Install from GitHub Releases

After the v1.0.0 release is published, install the CLI directly from its release tarball:

```bash
npm install --global https://github.com/yaona807/virune/releases/download/v1.0.0/virune-1.0.0.tgz
virune --version
```

The tarball contains the complete CLI dependency tree. The `virune` package and the internal `@virune/*` packages are not published to the npm Registry.

### Create a project

```bash
virune init hello
cd hello
npm install
npm run check
npm run start
```

`virune init` pins the CLI, Runtime, and standard library to the same GitHub Release assets. The project-level `npm install` makes generated ES modules independently executable by installing `@virune/runtime` and `@virune/stdlib` into the project.

Program arguments follow `--`:

```bash
npm run start -- Alice Bob
```

### Build and run from source

Use this path before the first GitHub Release or when contributing:

```bash
git clone https://github.com/yaona807/virune.git
cd virune
npm run bootstrap
npm run build
npm run virune -- --version
npm run example
```

Expected output includes:

```text
virune 1.0.0
Hello from Virune
```

`npm run bootstrap` installs the locked third-party dependencies from the public npm registry. It does not publish or install Virune packages from that registry. See the [clone guide](docs/getting-started-from-clone.md) for registry troubleshooting and environment details.

## JavaScript and TypeScript interoperability

Virune distinguishes Virune modules from JavaScript modules at the import site:

```virune
import { User } from "./user.virune"
import js { nanoid } from "nanoid"
import js axios from "axios"
import js * as fs from "node:fs/promises"
import js "./polyfill.js"
```

Safe FFI accepts only values that can be completely validated at runtime. Unsupported callbacks, unresolved generics, recursive aggregates, TypeScript `Record<K, V>`, and identity-sensitive object-keyed maps or sets fall back to `Unknown` or require a TypeScript adapter.

See [JavaScript and TypeScript interoperability](docs/js-interop.md), [binding coverage](docs/ffi-coverage.md), and the [normative FFI specification](spec/js-interop.md).

## VS Code support

Build and install the extension directly from the repository:

```bash
npm run pack:vscode
code --install-extension release/virune-vscode-1.0.0.vsix
```

The extension includes syntax and semantic highlighting, diagnostics, formatting, documentation-comment Hover and completion, symbols, go to definition, quick fixes, documentation snippets and generation commands, and the bundled Virune Language Server. See [VS Code support](docs/vscode.md) for details.

## Documentation

| Document | Purpose |
|---|---|
| [Getting started](docs/getting-started-from-clone.md) | Clone, install, build, run, and troubleshoot |
| [Language guide](docs/language-guide.md) | Practical introduction to Virune syntax and semantics |
| [CLI reference](docs/cli-reference.md) | Commands, options, and exit behaviour |
| [Standard library](docs/standard-library.md) | Node.js and browser adapters |
| [VS Code support](docs/vscode.md) | Extension installation and language features |
| [JavaScript interop](docs/js-interop.md) | FFI model, binding generation, and adapters |
| [Compiler API](docs/compiler-api.md) | Stable and experimental compiler interfaces |
| [Runtime ABI v2](docs/runtime-abi.md) | Generated-code runtime contract |
| [Normative specification](spec/README.md) | Exact Virune 1.0 language behaviour |

Japanese documentation uses the `_ja.md` suffix.

## Development and verification

Run the complete local quality gate:

```bash
npm run verify
```

The gate checks the Node.js baseline, registry configuration, release channel, compiler API compatibility, TypeScript build, unit and integration tests, binding corpus, fuzz smoke tests, VS Code and LSP behaviour, conformance fixtures, formatter output, normative specification coverage, grammar, clean-clone behaviour, release packages, and clean-install execution.

Create local release artifacts with:

```bash
npm run pack:virune
npm run pack:vscode
```

Artifacts, SHA-256 manifests, npm tarballs, and the VSIX are written to `release/`. The CLI tarball bundles its complete dependency tree and is tested with an offline clean install before release.

## Repository layout

| Path | Contents |
|---|---|
| `packages/compiler` | Lexer, parser, checker, project graph, emitter, evaluator, and public compiler API |
| `packages/runtime` | Runtime ABI v2 and native value operations |
| `packages/stdlib` | Node.js and browser adapters |
| `packages/formatter` | Canonical source formatter |
| `packages/language-server` | Language Server Protocol implementation |
| `packages/vscode` | Syntax definitions, extension client, and bundled server |
| `packages/js-interop` | TypeScript-backed binding and adapter validation |
| `packages/cli` | Project, build, run, formatting, test, binding, and conformance commands |
| `spec` | Normative Virune 1.0 specification |
| `conformance` | Accepted and rejected language fixtures with exact diagnostics |
| `corpus` | JavaScript and TypeScript interoperability corpus |
| `fuzz-regressions` | Reproducible crash and regression inputs |

## Stability and compatibility

Virune follows Semantic Versioning for documented stable APIs and the normative language specification. Runtime ABI v2 and Interop ABI v2 are the canonical ABIs for Virune 1.0. Compiler internals and explicitly experimental APIs are not covered by the stable compatibility guarantee.

See [release channels](docs/release-channels.md), [the compatibility policy for the Compiler API](docs/compiler-api.md), and [the stable release gate](docs/stable-release-gate.md).

## Contributing

Bug reports, documentation corrections, interoperability cases, and focused pull requests are welcome through [GitHub Issues](https://github.com/yaona807/virune/issues).

Before implementing a language change, open an issue so the syntax, semantics, compatibility impact, specification updates, and conformance coverage can be reviewed together. Pull requests should keep the English and Japanese documentation synchronized and pass `npm run verify`.

Virune is currently maintained by [Yaona](https://github.com/yaona807).

## Security and scope

Virune is not a security sandbox. JavaScript execution and `unsafe` interoperability remain outside the language's static safety guarantees. The project has not yet undergone an independent security audit.

## License

Virune is available under the [MIT License](LICENSE). Third-party notices are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
