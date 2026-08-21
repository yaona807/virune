# Contributing to Virune

日本語: [CONTRIBUTING_ja.md](CONTRIBUTING_ja.md)

This document is the entry point for developers changing Virune itself. A first-time contributor should be able to get from environment setup to a Pull Request from here.

## 1. Before you start

Follow the [Code of Conduct](CODE_OF_CONDUCT.md) for project interactions. Do not disclose security issues in public Issues; report them according to the [Security Policy](SECURITY.md).

Small typo fixes and obvious bug fixes may be submitted without opening an Issue first. Discuss the following changes in an Issue before implementation so that purpose, scope, compatibility, and safety impact are clear:

- large features or design changes
- Language Specification changes
- public Compiler API changes
- Runtime ABI or Interop ABI changes
- changes that affect compatibility policy
- changes to release or CI safety boundaries

If you are unsure, open an Issue before investing in a large implementation.

## 2. Set up the development environment

The required Node.js version is defined by `engines` in the root `package.json`. Use an npm version supported by that Node.js release.

```bash
git clone https://github.com/yaona807/virune.git
cd virune
npm run bootstrap
npm run build
```

`npm run bootstrap` runs `npm ci` against the public npm Registry and installs development dependencies exactly from the lockfile. Use this repository-owned setup path before introducing a custom installation procedure.

For a basic smoke check:

```bash
npm run virune -- --version
npm run test:core
```

When you need an exact command, check the current `scripts` section of `package.json` rather than old documentation or historical Pull Requests.

## 3. Find the right place to change

The main areas are:

| Path | Main responsibility |
|---|---|
| `packages/compiler` | Lexer, Parser, type checking, project processing, code generation, Compiler API |
| `packages/runtime` | Runtime used by generated code and public ABI |
| `packages/stdlib` | Standard library |
| `packages/formatter` | Formatter |
| `packages/js-interop` | JavaScript / TypeScript interoperability, bindings, Adapter validation |
| `packages/cli` | `virune` CLI |
| `packages/language-server` | Language Server |
| `packages/vscode` | VS Code extension |
| `spec` | Normative Language Specification and Runtime ABI |
| `conformance` | Specification conformance test data |
| `integration` | Cross-component integration tests |
| `selfhost` | Self-hosting compiler implemented in Virune |
| `.github` | Machine-readable CI, release, and self-hosting policy plus GitHub Actions workflows |
| `scripts` | Repository-owned build, validation, CI, and release logic |

Do not duplicate the same fact across multiple places. Current behavior belongs in code and tests, normative contracts belong in `spec/`, machine decisions belong in JSON and workflows, and implementation plans belong in Issues and Pull Requests.

### Compiler flow

For compiler-wide changes, first identify which stage owns the behavior. The high-level flow is:

```text
source
  ↓
Lexer / Parser
  ↓
AST
  ↓
project / module graph
  ↓
declaration collection / name resolution
  ↓
type / effect / control-flow / FFI checks
  ↓
HIR / MIR lowering
  ↓
ES2022 / Source Map output
```

The Lexer and Parser own syntax and source locations. The Checker owns semantic validation such as types, effects, and control flow. Lowering and code generation turn validated results into output that obeys the Runtime ABI and Interop ABI.

Keep internal AST, HIR, MIR, arenas, and semantic tables out of the Stable Compiler API.

## 4. Make a change

The normal sequence is:

1. Check the target Issue, related Pull Requests, and current `main`.
2. Create a branch from current `main`.
3. Keep the implementation to one purpose.
4. Run tests close to the changed code.
5. Add or update regression tests when behavior changes.
6. Update the Language Specification, API or ABI snapshots, or machine-readable policy in the same change when required.
7. Run the broader validation required by the change.
8. Open a Draft Pull Request and review the full diff and validation results.
9. Fix CI or review findings and validate the new head again.

Do not mix unrelated formatting, renaming, or refactoring into the same Pull Request.

For normal fixes, append commits as work progresses. Do not force-push merely because `main` advanced or because you want to collapse work-in-progress commits. Consider reconstruction from current `main` only when history is genuinely complicated, such as after a parent Pull Request is squash-merged and a normal rebase or merge is not a safe fit.

## 5. Choose tests

Start with focused validation close to the change, then expand to the required repository-level checks. `package.json` is the source of truth for the exact command set.

Common entry points include:

| Change | Main check |
|---|---|
| TypeScript types / build | `npm run check` |
| General Compiler or Runtime change | `npm run test:core` |
| Normative specification | `npm run spec:check` |
| Stable Compiler API | `npm run api:check` |
| Public ABI | `npm run abi:check` |
| Repository-wide validation | `npm run verify` |

For areas not listed here, inspect `package.json` and existing tests near the changed code first. Do not add a special bypass or a fixture-specific heuristic just to make tests pass.

For bug fixes, add a regression test that fails before the fix and passes after it whenever practical. Depending on the boundary, also consider malformed input, missing data, duplicates, stale state, boundary values, partial failure, cleanup, and determinism rather than testing only the normal path.

## 6. Change the Language Specification

[`spec/`](spec/README.md) is normative for Virune language behavior.

Do not change Parser or Checker behavior first and treat the specification as follow-up work. When a specification change is required, discuss the reason and compatibility impact in an Issue, then update the specification, implementation, and tests in the same Pull Request.

If the specification, implementation, and tests disagree, do not guess whichever interpretation is most convenient. Resolve the inconsistency before proceeding.

## 7. Change public APIs or ABIs

The machine-readable source of truth for the Stable Compiler API is `packages/compiler/api/stable-api.snapshot.json` together with the public entry point. Validate it with:

```bash
npm run api:check
```

For public Runtime, Interop, and standard-library ABI, review `packages/public-abi.snapshot.json` and [`spec/runtime-abi.md`](spec/runtime-abi.md), then run:

```bash
npm run abi:check
```

Updating a snapshot does not authorize an incompatible change. Evaluate changes to Stable contracts under [`COMPATIBILITY.md`](COMPATIBILITY.md).

## 8. Change self-hosting

Do not change the Virune language, Compiler API, Runtime ABI, Interop ABI, or public standard library solely to make self-hosting easier.

Only the **deterministic Compiler Kernel whose inputs and outputs can be represented as explicit data without environment dependencies** should move into Virune. Environment-dependent work and orchestration remain in the JavaScript / TypeScript Host.

The Host is responsible for work such as:

- CLI and process lifecycle
- filesystem access, path resolution, environment variables, and cryptographic hashing
- source discovery and loading
- parsing TypeScript declarations and JavaScript bindings
- VS Code and Language Server transport
- package creation, releases, and attestations
- bootstrap orchestration and rollback selection

The Host / Kernel boundary must be a versioned, validated, data-only contract. Do not pass callbacks, arbitrary JavaScript functions, class instances, TypeScript AST nodes, file handles, or other values that depend on object identity or the execution environment through that contract.

First try to solve a self-hosting limitation with existing language features, internal algorithms, or data contracts. If that is not appropriate, leave the responsibility in the Host. Do not add new syntax or public APIs solely for self-hosting.

The exact current self-hosting state, promotion requirements, seed, and corpus are defined by JSON under `.github/self-hosting/`, `selfhost/`, and the existing scripts and tests. Promotion to the Production Compiler is allowed only when the machine-readable policy requirements pass for the same candidate commit.

Choose self-hosting validation from the existing `selfhost:*` commands in `package.json` according to the boundary you changed. Do not create a shortcut that bypasses required validation.

## 9. Handle CI failures

A successful CI result is evidence for the **exact commit** on which it ran. After the Pull Request head changes, do not use success from an older head as evidence for the current change.

Classify a failure before acting:

- **Implementation or repository failure**: fix the cause and validate the new head.
- **Infrastructure failure**, such as GitHub Actions, runner, or external Action retrieval: rerun the same head only after confirming repository code is not the cause.
- **Unknown cause**: inspect logs and the failing boundary rather than rerunning on a guess.

Do not repeatedly rerun the same head until it happens to pass. Diagnostics that are needed repeatedly belong in repository-owned commands or permanent validation, not temporary workflows.

## 10. Change release behavior

Normal CI success alone does not authorize a stable release.

The exact release requirements are defined by `.github/stable-release-gate.json`, `.github/release/`, release workflows, and validation scripts. Published artifacts must match the reviewed identity: names, contents, hashes, source commit, and other required evidence.

Do not overwrite an existing published artifact through the normal path. During recovery, re-observe public state, do not republish artifacts that are already correct, and never treat an unknown state as safe.

## 11. Change documentation

Keep permanent Markdown in this repository to the minimum needed for development and long-lived contracts. Add a new permanent document only when all of the following are true:

1. The information cannot be recovered safely from code, tests, schemas, or workflows.
2. It is a long-lived contract rather than temporary context for one Issue or Pull Request.
3. It does not fit naturally in an existing document.
4. Its independent value justifies the ongoing maintenance cost.

For paired Japanese and English documents, **finish the Japanese version first**. Remove unnatural Japanese, unnecessary English mixing, and ambiguous wording, then create the English version from that reviewed meaning. Do not write English first and produce Japanese as a literal translation.

Do not duplicate a rule across documents. Link to the canonical location with relative links instead.

## 12. Pull Requests and review

Keep a Pull Request to one logical change. Record the related Issue, changed boundaries, intentionally unchanged boundaries, and validation performed. Keep incomplete or unvalidated work as Draft.

Design, implementation, Pull Request readiness, and merge decisions require adversarial review: try to break the change instead of defending it.

1. Re-read the requirements, Acceptance Criteria, and invariants.
2. Review the complete current diff.
3. Fix every actionable finding.
4. Run the focused validation required by the fix.
5. Review the resulting diff again from the beginning.
6. Repeat until a complete pass produces zero new actionable findings.

Green CI and the number of review passes are not stop conditions.

Before merge, verify at least the current head, formal CI, final diff, unresolved review threads, Acceptance Criteria, and any remaining TODO or temporary path. If the head changes, rerun the required CI and final review.

A Pull Request containing Japanese documentation must not merge until the maintainer explicitly approves the Japanese diff for the final head. If the head changes after approval, the Japanese diff must be reviewed again.

Use squash merge by default.

## 13. License

Virune is licensed under the [Apache License 2.0](LICENSE).

Unless explicitly stated otherwise, code and documentation submitted for inclusion in Virune are provided under Apache License 2.0. If a contribution includes third-party code, text, images, or other material, confirm that you have the necessary rights and preserve any required notices.
