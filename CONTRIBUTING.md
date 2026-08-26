# Contributing to Virune

日本語: [CONTRIBUTING_ja.md](CONTRIBUTING_ja.md)

Contributions to Virune are welcome.

This document covers the basic workflow from development setup through implementation, testing, and opening a Pull Request.

## Before you start

Follow the [Code of Conduct](CODE_OF_CONDUCT.md) for project interactions.

Do not disclose security issues in public Issues. Report them according to the [Security Policy](SECURITY.md).

Typos and small bug fixes may be submitted without opening an Issue first.

For changes with a larger impact, discuss the purpose and scope in an Issue before implementation. This includes:

- large features or design changes
- changes to language syntax or type rules
- changes to the Compiler API used by external tools
- changes to how generated code connects to the Runtime or JavaScript interop
- changes that affect compatibility for existing users
- changes that affect CI or release safety

When a large feature is split across several Pull Requests, it may be useful to separate an Issue that tracks the overall work from Issues for individual implementation changes.

If a change addresses an existing Issue, reference that Issue from the Pull Request.

## Development setup

The required Node.js version is listed in the `engines` field of the root `package.json`.

Clone the repository and run:

```bash
git clone https://github.com/yaona807/virune.git
cd virune
npm run bootstrap
npm run build
```

`npm run bootstrap` installs the development dependencies according to the lockfile.

After setup, verify that the CLI starts:

```bash
npm run virune -- --version
```

Run the main compiler and Runtime tests with:

```bash
npm run test:core
```

For other development commands and tests, check the `scripts` field in the root `package.json`.

## Repository structure

The main directories are:

| Path | Primary role |
|---|---|
| `packages/compiler` | Compiler that parses Virune code, checks types, and generates JavaScript |
| `packages/runtime` | Runtime used by generated JavaScript |
| `packages/stdlib` | Standard library available to Virune programs |
| `packages/formatter` | Virune code formatter |
| `packages/js-interop` | JavaScript / TypeScript library interop |
| `packages/cli` | `virune` command |
| `packages/language-server` | Language Server for editor completion and diagnostics |
| `packages/vscode` | VS Code extension |
| `spec` | Virune Language Specification and Runtime ABI |
| `conformance` | Tests that check behavior against the Language Specification |
| `integration` | Tests that exercise multiple components together |
| `selfhost` | Self-hosted compiler implemented in Virune |
| `.github` | GitHub Actions, CI, release, and related configuration |
| `scripts` | Build and validation scripts |

### Compiler flow

When changing the compiler, it helps to identify which stage owns the behavior you want to change.

At a high level:

```text
Virune source code
  ↓
Lexer / Parser
  ↓
AST
  ↓
name resolution / type checking
  ↓
HIR / MIR
  ↓
JavaScript / Source Map
```

The AST represents the structure of parsed source code.

After names and types are checked, the compiler transforms the program into internal intermediate representations called HIR and MIR before generating JavaScript.

AST, HIR, MIR, and similar internal representations are not exposed directly through the Stable Compiler API.

## Making a change

A typical change follows this workflow:

1. Check related Issues and Pull Requests.
2. Create a working branch from the latest `main`.
3. Implement the change and run tests close to the changed code.
4. When behavior changes, add a regression test when appropriate.
5. If the change affects the Language Specification or public API / ABI, update the related specification or snapshot as part of the same change.
6. Run the necessary tests and open a Pull Request.

If CI or review finds a problem, fix it and rerun the tests affected by the change.

Avoid mixing unrelated formatting, refactoring, or renaming into the same Pull Request.

### Stacked Pull Requests

A Pull Request may be stacked when its change depends on another Pull Request.

Changes that can be implemented and tested independently should each start from `main`.

Stacks are limited to two levels: one parent Pull Request and one child Pull Request.

After the parent is merged, change the child Pull Request base to `main` and bring in the latest `main` when needed.

## Testing

Start with tests close to the code you changed, then expand the validation scope as needed.

Common commands are:

| Change | Main command |
|---|---|
| Check TypeScript types or the build | `npm run check` |
| Change the compiler or Runtime | `npm run test:core` |
| Change language syntax or type rules | `npm run spec:check` |
| Change the external Compiler API | `npm run api:check` |
| Change the public Runtime or Interop interface | `npm run abi:check` |
| Run broad repository validation | `npm run verify` |

Other tests may be required depending on the change. Available commands are listed in the `scripts` field of `package.json`.

For bug fixes, add a regression test that fails before the fix and passes after it whenever practical.

Depending on the change, also consider invalid input, boundary values, missing or duplicate data, partial failure, and cleanup behavior.

For operations that must be deterministic, check that execution order or environment does not change the result for the same input.

Do not special-case a particular input only to make a test pass, and do not weaken safety checks or existing validation for that purpose.

## Changes with a larger impact

Read the relevant section below when your change touches one of these areas.

### Language Specification

Virune syntax and type rules are documented under [`spec/`](spec/README.md).

Examples of Language Specification changes include:

- adding new syntax
- changing the meaning of existing syntax
- changing type-checking rules
- changing language-defined behavior such as `Option` or `Result`

For these changes, update the relevant specification in the same Pull Request as the implementation and tests.

If the specification, implementation, and tests disagree, do not simply change one to match another. Check the relevant Issue and existing specification, clarify the intended behavior, and then fix the inconsistency.

### Compiler API

The Virune compiler exposes an API that external tools can use in addition to the CLI. This is the Compiler API.

Public functions and types are also recorded in `packages/compiler/api/stable-api.snapshot.json`. This file is used to detect unintended changes to the public API.

After changing the Compiler API, run:

```bash
npm run api:check
```

Removing a public function or changing its parameters or return type can break existing tools that use the API.

For that reason, when `api:check` fails, do not update the snapshot only to make the check pass.

If a public API change is intentional, read the [Compatibility Policy](COMPATIBILITY.md) and use an Issue to document why the change is needed and how it affects existing users.

### Runtime ABI / Interop ABI

Generated Virune JavaScript calls functions provided by the Runtime. JavaScript library interop also depends on agreed formats for passing values across the boundary.

The rules used to connect these components are called ABIs.

Virune mainly has:

- the Runtime ABI between generated code and the Runtime
- the Interop ABI between Virune and JavaScript interop

Changing these rules can break previously generated code or existing interop code.

For changes to a public ABI, check `packages/public-abi.snapshot.json` and [`spec/runtime-abi.md`](spec/runtime-abi.md), then run:

```bash
npm run abi:check
```

If the change affects compatibility for existing users, also review the [Compatibility Policy](COMPATIBILITY.md).

### Self-hosting

Virune includes a Self-hosting system in which parts of the Virune compiler are implemented in Virune itself.

This does not mean every compiler responsibility should move into Virune.

Work such as lexing, parsing, and type checking can be implemented on the Virune side when it can take explicit inputs and return explicit results.

Environment-dependent work remains on the JavaScript / TypeScript side, including:

- file I/O
- path resolution
- processes and environment variables
- TypeScript declaration analysis
- CLI and editor communication
- packaging and release operations

Moving this boundary only to make Self-hosting easier would make the language or public API more complex. Do not change the Virune Language Specification, Compiler API, Runtime ABI, Interop ABI, or public standard library solely for Self-hosting convenience.

For the current Self-hosting implementation and validation, check `.github/self-hosting/`, `selfhost/`, and the related scripts and tests.

Do not bypass existing Self-hosting checks.

### Release changes

Most code changes do not need this section.

Changes to release conditions or publishing behavior can affect release-specific validation in addition to normal CI.

Relevant configuration and code include:

- `.github/stable-release-gate.json`
- `.github/release/`
- release-related GitHub Actions workflows
- release verification scripts

Do not weaken or bypass release checks.

Do not overwrite an already-published release artifact with different contents.

## CI

GitHub Actions run according to the contents of each Pull Request.

A CI result applies to the commit on which that CI run executed. If code changes after CI runs, make sure the required checks also succeed on the updated commit.

When CI fails, inspect the logs first.

If the cause is code or tests, fix the problem.

If the failure is confirmed to be temporary infrastructure trouble, such as GitHub Actions or a runner problem, rerunning the same commit is acceptable.

Avoid repeatedly rerunning a failure until it turns green without first identifying the cause.

## Documentation changes

We keep permanently maintained documentation to the minimum needed.

Before adding a new Markdown file, check whether the information belongs in an existing README, CONTRIBUTING, COMPATIBILITY document, or under `spec/`.

Explanations needed only for one Issue or Pull Request should stay in that Issue or Pull Request.

Paired Japanese and English documents should contain the same rules and meaning.

Prefer natural writing in each language over literal translation.

When possible, link to the relevant document instead of copying the same explanation into several places.

## Pull Requests

Keep each Pull Request focused on one purpose when possible.

Depending on the change, include the following in the description:

- what changed
- related Issue
- why the change is needed
- tests that were run
- compatibility or safety impact, when relevant

Use a Draft Pull Request when implementation or required validation is still in progress.

During review, check that the change behaves as intended, has the necessary tests, and does not break existing compatibility.

Also check error and partial-failure handling, unrelated changes, and leftover debugging code.

After making a fix, rerun tests affected by that change.

Before merge, make sure required CI has passed, review comments are resolved, and the diff contains no unintended changes.

Virune uses squash merge by default.

Do not close a related Issue only because its Pull Request was merged. Close it after the required change is present on `main` and the Issue's requirements are satisfied.

## License

Virune is distributed under the [Apache License 2.0](LICENSE).

Unless explicitly stated otherwise, code and documentation submitted for inclusion in Virune are provided under the Apache License 2.0 terms.

If a contribution includes third-party code, text, images, or other material, confirm that its license allows the project to use it and preserve any required notices.