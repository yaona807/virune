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

For larger efforts, separate the Issue that tracks several implementation changes from the Issue that completes one implementation change. A Pull Request should normally reference its implementation Issue, and its purpose and completion criteria must still be understandable from the Pull Request itself. Do not treat an Issue as complete merely because a Pull Request was merged. Close it only after the required criteria have been verified on the current `main` branch.

If you are unsure, open an Issue before investing in a large implementation.

## 2. Set up the development environment

The `engines` field in the root `package.json` is authoritative for the required Node.js version. Use an npm version supported by that Node.js release.

```bash
git clone https://github.com/yaona807/virune.git
cd virune
npm run bootstrap
npm run build
```

`npm run bootstrap` runs `npm ci` against the public npm Registry and prepares development dependencies exactly as recorded in the lockfile. Use this command before inventing a separate setup path.

For a minimal smoke check, run:

```bash
npm run virune -- --version
npm run test:core
```

When you need a command that is not shown here, use the current `package.json` `scripts` as the source of truth rather than an old document or Pull Request.

## 3. Find the right area

The main areas are:

| Path | Primary responsibility |
|---|---|
| `packages/compiler` | Lexer, Parser, type checking, project processing, code generation, Compiler API |
| `packages/runtime` | Runtime used by generated code and its public ABI |
| `packages/stdlib` | Standard library |
| `packages/formatter` | Formatter |
| `packages/js-interop` | JavaScript/TypeScript interop, bindings, Adapter validation |
| `packages/cli` | `virune` CLI |
| `packages/language-server` | Language Server |
| `packages/vscode` | VS Code extension |
| `spec` | Normative Language Specification and Runtime ABI |
| `conformance` | Test data for specification conformance |
| `integration` | Tests crossing component boundaries |
| `selfhost` | Self-hosted compiler implemented in Virune |
| `.github` | Machine-readable CI, release, and Self-hosting policies and GitHub Actions workflows |
| `scripts` | Repository-owned build, validation, CI, and release tooling |

Do not duplicate the same rule in several places. Current behavior belongs in code and tests, normative contracts in `spec/`, machine decisions in JSON and workflows, and implementation-specific plans in Issues and Pull Requests.

### Compiler flow

When changing the compiler as a whole, first identify the stage that owns the behavior. At a high level:

```text
source code
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

The Lexer and Parser handle syntax and source positions. The Checker validates meaning such as types, effects, and control flow. Lowering and code generation transform validated results into output that obeys the Runtime ABI and Interop ABI.

Keep internal AST, HIR, MIR, arenas, and semantic tables out of the Stable Compiler API.

## 4. Make a change

A normal change follows this sequence:

1. Check the target Issue, related Pull Requests, and current `main`.
2. Create a branch from current `main`.
3. Implement one logical purpose.
4. Run tests close to the changed code.
5. Add or update a regression test when behavior changes.
6. Update the Language Specification, API/ABI snapshots, or machine-readable policy in the same change when required.
7. Run the necessary repository-wide validation.
8. Open a Draft Pull Request and inspect the complete diff and validation evidence.
9. Fix findings from CI and review, then validate the new head again.

Do not mix unrelated formatting, renaming, or refactoring into the same Pull Request.

Start independent work from current `main`. Stack Pull Requests only when the child cannot be implemented or meaningfully validated against `main` alone because of a real source-code or test dependency. The maximum stack depth is two open levels: one parent and one child. Do not stack merely to run CI, avoid a conflict, or express work order.

For ordinary fixes, append commits instead of rewriting the branch. Do not force-push merely because `main` advanced or because work-in-progress commits could be collapsed. If a parent Pull Request was squash-merged and the remaining history is genuinely difficult to reconcile safely with a normal rebase or merge, consider a clean reconstruction from current `main`. Do not create a Pull Request whose only purpose is ancestry repair.

## 5. Choose validation

Start with validation close to the change, then expand to the required full validation. The exact command list in `package.json` is authoritative.

Common entry points are:

| Change | Primary validation |
|---|---|
| TypeScript type/build changes | `npm run check` |
| General Compiler or Runtime changes | `npm run test:core` |
| Normative specification | `npm run spec:check` |
| Stable Compiler API | `npm run api:check` |
| Public ABI | `npm run abi:check` |
| Repository-wide validation | `npm run verify` |

For areas not covered by this table, inspect `package.json` and existing tests near the changed code first. Never add an exception path solely to pass a test, and never add logic tailored to one fixture.

For a bug fix, add a regression test that fails before the fix and passes after it whenever practical. Beyond the normal case, check malformed input, missing or duplicate data, stale state, boundaries, partial failure, cleanup, and determinism when they are relevant.

## 6. Change the Language Specification

[`spec/`](spec/README.md) is authoritative for Virune language behavior.

Do not change only the Parser or Checker and defer the specification. When behavior requires a specification change, discuss the reason and compatibility impact in an Issue, then update specification, implementation, and tests in the same Pull Request.

If specification, implementation, and tests disagree, do not choose whichever interpretation is convenient. Resolve the contradiction before treating any behavior as correct.

## 7. Change a public API or ABI

The machine-readable baseline for the Stable Compiler API is `packages/compiler/api/stable-api.snapshot.json` together with the public entry points. Validate it with `npm run api:check`.

For public Runtime, Interop, and standard-library ABI, inspect `packages/public-abi.snapshot.json` and [`spec/runtime-abi.md`](spec/runtime-abi.md), then run `npm run abi:check`.

Updating a snapshot does not authorize an incompatible change. Evaluate changes to Stable contracts according to [`COMPATIBILITY.md`](COMPATIBILITY.md).

## 8. Change Self-hosting

Do not change the Virune language, Compiler API, Runtime ABI, Interop ABI, or public standard library merely to make Self-hosting easier.

Only move a **deterministic Compiler Kernel whose inputs and outputs can be represented as explicit data and do not depend on the external environment** into Virune. Keep environment-dependent work and orchestration in the JavaScript/TypeScript Host.

Responsibilities that remain in the Host include:

- CLI and process lifecycle
- filesystem access, path resolution, environment variables, and cryptographic hashing
- source-file discovery and reading
- TypeScript declaration and JavaScript binding analysis
- VS Code and Language Server transport
- packaging, release, and attestation
- bootstrap orchestration and rollback selection

The Host/Kernel boundary must be a versioned, verifiable, data-only contract. Do not put callbacks, arbitrary JavaScript functions, class instances, TypeScript AST nodes, file handles, or other values that depend on object identity or the execution environment into that contract.

First try existing language features, internal algorithms, and data contracts. If the work still does not belong in the Kernel, leave the responsibility in the Host. Do not add language syntax or public API surface solely for Self-hosting.

Current Self-hosting state, promotion conditions, seeds, corpora, and similar values are defined by JSON under `.github/self-hosting/`, `selfhost/`, repository scripts, and tests. Promotion to the Production Compiler is allowed only when the machine-readable policy requirements are satisfied for the same candidate commit.

For diagnosis, use existing `selfhost:*` entry points from `package.json` first. A diagnostic that is repeatedly needed should become a permanent repository-owned command instead of living only inside GitHub Actions.

Temporary workflows, scripts, and diagnostic paths are exceptional. Record why existing paths are insufficient, the removal condition, and the responsible Pull Request in `.github/self-hosting/temporary-artifacts.json`. A temporary path must not weaken or bypass an existing gate, and both the artifact and its registry entry must be removed before the Pull Request is made ready for review.

## 9. Handle CI failures

A successful CI result is evidence for the **exact commit** on which it ran. After the head changes, do not reuse success from an older head as evidence for the current change.

Classify the failure before acting:

- **Implementation or repository failure**: fix the cause and validate the new head.
- **Infrastructure failure such as GitHub Actions, a runner, or external Action retrieval**: retry the same head only after confirming the repository code did not cause the failure.
- **Unknown cause**: inspect logs and the failing boundary instead of rerunning by guesswork.

Do not repeatedly rerun the same head until it turns green. Diagnostics that are needed repeatedly belong in repository-owned commands or permanent validation, not in temporary workflows.

## 10. Change release behavior

Passing ordinary CI does not authorize a stable release.

The exact release conditions are defined by `.github/stable-release-gate.json`, `.github/release/`, release workflows, and verification scripts. Published artifacts must match the reviewed artifact identity, including the required filename, bytes, hashes, and source commit.

Do not overwrite an existing published artifact through the normal release path. Recovery must begin by observing the public state again, must not republish an already-correct artifact, and must never treat an unknown state as safe.

## 11. Change documentation

Keep permanent Markdown in this repository to the minimum needed. Add a new permanent document only when all of the following are true:

1. The information cannot be recovered safely from code, tests, schemas, or workflows.
2. It is a long-lived contract rather than temporary explanation for one Issue or Pull Request.
3. It does not fit naturally into an existing document.
4. Its independent maintenance cost is justified.

For paired Japanese and English documents, **finish the Japanese version first**. Remove unnatural Japanese, unnecessary English mixing, and ambiguous wording before using that meaning to write the English version. Do not write English first and then translate it literally into Japanese.

Do not copy the same rule into several documents. Use relative links to the canonical source.

## 12. Pull Requests and review

Keep each Pull Request to one logical change. Its description should identify the related Issue, changed boundaries, boundaries intentionally left unchanged, and validation performed. Keep unfinished or unvalidated work as Draft.

For design, implementation, Pull Request readiness, and merge decisions, review the change from the perspective of trying to break it rather than defend it:

1. Recheck requirements, Acceptance Criteria, and invariants.
2. Review the complete current diff.
3. Fix every actionable finding.
4. Run the focused validation required by the fix.
5. Review the updated diff again from the beginning.
6. Repeat until a complete pass finds no new actionable issue.

CI success and the number of review passes are not stop conditions.

Before merge, verify at least the current head, formal CI, final diff, unresolved review threads, Acceptance Criteria, and any remaining TODO or temporary path. If the head changes, repeat the required CI and final review.

A Pull Request that changes Japanese documentation must not be merged until the maintainer explicitly approves the Japanese diff at the final head. Any later head change requires another review.

Use squash merge by default. When completion criteria require post-merge evidence, verify them on `main` before closing the Issue.

## 13. License

Virune is distributed under the [Apache License 2.0](LICENSE).

Unless explicitly stated otherwise, code and documentation submitted for inclusion in Virune are provided under the Apache License 2.0 terms. If a contribution includes third-party code, text, images, or other material, confirm that the project may use it and preserve all required notices.
