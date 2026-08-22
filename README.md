<p align="center">
  <img src="assets/virune-logo.svg" alt="Virune" width="520">
</p>

<h1 align="center">Virune</h1>

<p align="center">
  A statically typed programming language for the JavaScript ecosystem.
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

## About this repository

This repository is the source of truth for developing and maintaining Virune itself. It contains the compiler, Runtime, standard library, CLI, editor integration, self-hosting implementation, tests, CI, and normative specification.

For precise language behavior, see [`spec/`](spec/README.md). To contribute to Virune development, start with [`CONTRIBUTING.md`](CONTRIBUTING.md).

## Run from source

The supported Node.js version is defined by `engines` in the root `package.json`. From an existing checkout, run:

```bash
npm run bootstrap
npm run build
npm run virune -- --version
```

Setup details, test selection, and Pull Request requirements are documented in [`CONTRIBUTING.md`](CONTRIBUTING.md).

## Main directories

| Path | Purpose |
|---|---|
| `packages/compiler` | Lexer, Parser, type checking, project processing, code generation, Compiler API |
| `packages/runtime` | Runtime used by generated code |
| `packages/stdlib` | Standard library |
| `packages/js-interop` | JavaScript / TypeScript interoperability |
| `packages/cli` | `virune` CLI |
| `packages/language-server` | Language Server |
| `packages/vscode` | VS Code extension |
| `spec` | Normative language specification and Runtime ABI |
| `conformance` | Specification conformance test data |
| `integration` | Cross-component integration tests |
| `selfhost` | Self-hosting compiler implemented in Virune |
| `scripts` | Repository-owned build, validation, release, and CI scripts |

## Releases

Published artifacts are available from [GitHub Releases](https://github.com/yaona807/virune/releases). Release eligibility is determined by repository-owned machine-readable policy and CI; this README does not duplicate version-specific release procedures.

## License

Virune is licensed under the [Apache License 2.0](LICENSE). See [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) for third-party software notices.
