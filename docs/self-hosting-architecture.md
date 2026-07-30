# Self-hosting architecture

[English](self-hosting-architecture.md) | [日本語](self-hosting-architecture_ja.md)

- Status: Accepted
- Scope: Virune compiler self-hosting
- Parent issue: [#88](https://github.com/yaona807/virune/issues/88)
- Tracking issue: [#89](https://github.com/yaona807/virune/issues/89)

## Decision

Virune will move only the deterministic, data-oriented compiler kernel into Virune source. Environment integration, orchestration, packaging, and compatibility adapters remain in the JavaScript and TypeScript host.

The governing rule is:

> Do not change Virune to self-host Virune.

Self-hosting work must not change the Virune 1.0 language, public standard library, stable Compiler API, Runtime ABI, Interop ABI, or unsafe FFI rules merely to make the compiler implementation easier. When an operation cannot be expressed naturally with the current language and public runtime, the implementation must first be redesigned, then optimized within existing contracts, and finally left in the host if necessary.

Self-hosting code may be merged incrementally into `main`, but it remains isolated from the production compiler path until every promotion gate in this document is satisfied.

## Goals

- Implement the pure compiler kernel in Virune.
- Build the kernel with a fixed Stage 0 compiler.
- Rebuild the same kernel with Stage 1 and compare Stage 1 and Stage 2 deterministically.
- Compare the self-hosted kernel with the existing TypeScript compiler by accepted input, diagnostics, generated modules, metadata, and runtime behaviour.
- Preserve a reviewed rollback path to the legacy compiler.

## Non-goals

- Removing all JavaScript or TypeScript from the repository.
- Replacing Node.js, ESM, npm, the CLI host, the Language Server transport, or the VS Code Extension Host.
- Translating Chevrotain, TypeScript Compiler API objects, or Node.js filesystem objects into Virune.
- Adding compiler-only syntax, attributes, effects, intrinsics, reflection, unchecked casts, mutable record fields, or public standard-library APIs.
- Switching the production compiler before compatibility, determinism, performance, and rollback gates pass.

## Architecture

```text
┌──────────────────────────────────────────────────────────┐
│ JavaScript / TypeScript host                              │
│                                                          │
│ CLI, filesystem, path resolution, TypeScript API,        │
│ JavaScript binding analysis, VS Code, LSP transport,     │
│ packaging, release automation, bootstrap orchestration   │
└────────────────────────────┬─────────────────────────────┘
                             │ versioned, validated data only
                             ▼
┌──────────────────────────────────────────────────────────┐
│ Virune compiler kernel                                   │
│                                                          │
│ token model, lexer, parser, AST, diagnostics, symbols,   │
│ types, effect checking, HIR, module semantics, emitter   │
└────────────────────────────┬─────────────────────────────┘
                             │ deterministic KernelOutput
                             ▼
                   readable ES2022 modules
```

The host is responsible for effects and environment-specific behaviour. The kernel is responsible for pure or explicitly state-threaded language semantics.

## Host responsibilities

The JavaScript and TypeScript host retains:

- CLI entry points and process lifecycle.
- Filesystem access, canonical path resolution, environment variables, and cryptographic hashing.
- Project source discovery and source text loading.
- TypeScript declaration parsing and JavaScript binding analysis.
- Construction and validation of the Interop Manifest.
- Source map final encoding when platform libraries are required.
- Language Server transport and VS Code Extension Host integration.
- Package assembly, release publication, attestations, and GitHub Actions helpers.
- Stage 0 acquisition, seed verification, Stage 1 and Stage 2 orchestration, and rollback selection.

These responsibilities may call the kernel through a versioned adapter, but they must not expose environment objects through the contract.

## Kernel responsibilities

The Virune compiler kernel may contain:

- Source positions, spans, token kinds, tokens, and documentation-comment metadata.
- Lexer and hand-written parser.
- AST, symbol, type, effect, and diagnostic models.
- Name resolution, visibility, control-flow validation, type checking, and effect checking.
- HIR or an equivalent explicit lowering model.
- Deterministic JavaScript module emission.
- Module graph and public API validation from already collected canonical sources.
- Processing of a validated, data-only Interop Manifest.
- Canonical serialization used by differential and bootstrap comparisons.

The kernel must use immutable values, arena IDs, canonical tables, sorted collections, or explicit state passing instead of identity-sensitive object graphs.

## Host–kernel contract

The boundary must be versioned, machine-readable, serializable as JSON-equivalent data, and validated in both directions.

### Allowed input

A `KernelInput` may contain:

- Contract version and language version.
- Target platform.
- Canonical entry path.
- Canonically ordered pairs of source path and source text.
- A versioned, validated Interop Manifest.
- Emit and diagnostic options represented as plain data.

### Allowed output

A `KernelOutput` may contain:

- Diagnostics with stable code, severity, ranges, related information, help, and structured fixes.
- Emitted JavaScript modules and source-map segments.
- Exported symbols and public API metadata.
- Module dependencies and canonical module ordering.
- Compilation statistics represented as deterministic data.

### Forbidden boundary values

The contract must reject or avoid:

- Callbacks or arbitrary JavaScript functions.
- Class instances or prototype-sensitive values.
- TypeScript AST nodes or Compiler API objects.
- Chevrotain CST nodes or parser objects.
- Node.js `Error` objects, filesystem handles, streams, buffers used as identity-bearing objects, or process objects.
- VS Code, LSP transport, or editor-host objects.
- Maps, sets, or object graphs whose meaning depends on insertion order or object identity.

## Protected surfaces

Self-hosting work must not alter the following surfaces for implementation convenience:

- Normative semantics under `spec/`.
- Grammar, keywords, precedence, or token rules.
- Public standard-library APIs.
- Runtime ABI v2.
- Interop ABI v2.
- Stable Compiler API responses and compatibility policy.
- Safe and unsafe FFI boundaries.
- Existing accepted and rejected conformance behaviour.

A genuine language proposal may change a protected surface only in a separate issue and pull request. It must be justified by general user needs independently of self-hosting and must include specification, compatibility, conformance, documentation, and migration analysis.

## Parser and state model

The self-hosted parser is a new implementation, not a mechanical port of Chevrotain.

- Use recursive descent for declarations, statements, and type forms.
- Use Pratt parsing or precedence climbing for expressions.
- Build the AST directly without exposing a CST.
- Recover from syntax errors with reviewed synchronization-token sets.
- Associate documentation comments through token metadata.

Compiler state should prefer:

- Immutable records and enums.
- Explicit state transitions.
- Arena IDs for nodes, symbols, and types.
- Canonical tables and deterministic serialization.
- Stable ordering independent of hash-table or insertion behaviour.

Performance problems must first be addressed through algorithms, persistent structures, runtime-internal optimization, or host placement. They do not justify relaxing the protected surfaces.

## Integration and command isolation

Self-hosting commands use the `selfhost:*` namespace. They must remain separate from the existing `bootstrap` command and normal user-facing compiler commands.

Examples include:

- `selfhost:seed:verify`
- `selfhost:mvp:check`
- `selfhost:mvp:test`
- `selfhost:differential`
- `selfhost:bootstrap`

Until production promotion, normal commands such as `virune check`, `virune build`, `virune run`, and the stable Compiler API continue to use the legacy compiler by default.

Incomplete self-hosting components may be merged into `main` when:

- The production path is unchanged.
- Existing quality gates remain enabled and pass.
- The component is accessible only through internal modules or `selfhost:*` commands.
- Public APIs and ABIs do not expose incomplete self-hosting types.
- Added behaviour is deterministic and has focused tests.

## Stop and escalation conditions

Implementation in a self-hosting issue must stop before changing a protected surface when any of the following occurs:

- The design appears to require new syntax, a keyword, a built-in effect, a compiler intrinsic, reflection, unchecked casting, mutable record fields, class inheritance, macros, or operator overloading.
- The design requires a self-hosting-only public standard-library API.
- The host–kernel contract cannot remain data-only.
- Correctness depends on object identity, hash iteration order, ambient filesystem state, or an undocumented runtime behaviour.
- A compatibility difference cannot be explained and reviewed as an expected, temporary divergence.
- The implementation cannot meet determinism, memory, or performance budgets without weakening language or safety guarantees.

The required response order is:

1. Redesign using existing `record`, `enum`, `fn`, `Result`, `Option`, immutable collections, arena IDs, and explicit state passing.
2. Improve the algorithm or an internal runtime implementation without changing public contracts.
3. Keep the operation in the TypeScript host.
4. Open a separate language proposal only when the capability is independently valuable to normal Virune programs.

The self-hosting pull request must not contain that language proposal.

## Staged rollout

1. **Architecture** — accept this ADR and protected-surface rules.
2. **Contract** — define `KernelInput`, `KernelOutput`, validation, and the legacy adapter.
3. **Seed** — fix and verify the Stage 0 compiler artifact and metadata.
4. **Differential harness** — compare two implementations through the same contract.
5. **Vertical MVP** — compile a deliberately small language subset from Virune source to ES2022.
6. **Frontend compatibility** — implement the complete Virune 1.0 lexer and parser.
7. **Semantic compatibility** — implement types, effects, control flow, concurrency, and FFI validation.
8. **Project compatibility** — implement multi-module semantics and Interop Manifest consumption.
9. **Non-blocking shadow** — run comparison jobs without affecting normal pull requests.
10. **Required shadow** — require self-host checks first for self-host changes, then for relevant compiler changes.
11. **Internal opt-in** — permit explicit selection through the compiler facade.
12. **Production default** — switch only after every promotion gate passes.
13. **Legacy retirement** — consider removal only after the retention and rollback requirements pass.

## Production promotion gates

The self-hosted compiler must not become the default until all of the following are demonstrated against the exact candidate commit:

- Full conformance accepted and rejected results match the legacy compiler.
- No unexplained diagnostic difference exists for code, severity, range, related information, help, or structured fixes.
- Public Compiler API responses remain compatible.
- Runtime ABI v2 and Interop ABI v2 remain compatible.
- Node.js and browser integration pass.
- Fuzz regressions, semantic fuzzing, and binding corpus checks pass.
- Stage 0 builds Stage 1, and Stage 1 rebuilds the same source as Stage 2.
- Normalized Stage 1 and Stage 2 JavaScript, source maps, module order, exports, diagnostics schema, metadata, and checksums match.
- Clean-clone and offline bootstrap checks pass.
- Median cold and incremental build time are no more than 1.25 times the legacy compiler.
- Peak resident memory and artifact size are no more than 1.5 and 1.25 times the legacy compiler respectively.
- No severe individual-fixture regression is hidden by aggregate performance results.
- Legacy fallback and release-repair rollback smoke tests pass.
- English and Japanese operational documentation are synchronized.

A gate failure postpones promotion. It does not permit weakening an existing quality, security, compatibility, or release check.

## Legacy retention and rollback

The compiler facade must retain explicit legacy and self-hosted implementations during rollout.

After the production default changes:

- The legacy compiler remains available for at least one complete stable release cycle.
- A stable release containing the self-hosted default must be published and verified.
- The next release candidate must be generated from the preceding self-hosted stable release.
- No severe unexplained compatibility difference may remain during the retention period.
- The fixed Stage 0 seed, checksum, and verification metadata must remain available.
- A clean clone must be able to bootstrap the compiler.
- Release repair, seed restoration, and legacy fallback must be tested.

Rollback changes only compiler selection. It must not require changing the language specification, public API, ABI, user source, or released seed bytes.

The legacy compiler core may be removed only in a separately reviewed pull request after all retention requirements pass. CLI hosting, JavaScript and TypeScript interoperability providers, VS Code hosting, LSP transport, packaging, release automation, and bootstrap orchestration are not legacy-core removal targets.

## Verification

Documentation changes must pass:

```bash
npm run docs:check
```

Implementation pull requests must run their focused self-hosting checks and all existing checks selected by repository policy. No self-hosting pull request may remove, bypass, or downgrade an existing CI, security, compatibility, reproducibility, or release gate.
