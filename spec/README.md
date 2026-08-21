# Virune 1.0 Normative Specification

[日本語](README_ja.md)

This directory defines the normative language contract and Runtime ABI for Virune 1.0. When another explanation disagrees with language behavior defined here, this directory takes precedence.

Major externally observable rules have stable identifiers such as `[type.nominal-identity]`. `rules.json` maps those rules to conformance or integration tests.

When language behavior changes, update the corresponding specification and tests in the same Pull Request instead of changing implementation first and treating the specification as follow-up work. If compatibility is affected, also follow [`COMPATIBILITY.md`](../COMPATIBILITY.md).

## Documents

- `grammar.ebnf` — normative grammar and newline-normalization contract
- `lexical.md` / `lexical_ja.md` — source encoding, tokens, comments, and statement termination
- `documentation.md` / `documentation_ja.md` — documentation comments, Markdown, and diagnostics
- `types.md` / `types_ja.md` — type identity, inference, generics, nullability, effects, functions, and `record`
- `evaluation.md` / `evaluation_ja.md` — evaluation order, control flow, errors, and cleanup
- `modules.md` / `modules_ja.md` — modules, imports, visibility, re-exports, and platforms
- `entry-point.md` / `entry-point_ja.md` — executable `main` signature and exit behavior
- `tasks.md` / `tasks_ja.md` — asynchronous execution and structured concurrency
- `ffi.md` / `ffi_ja.md` — core JavaScript boundary rules
- `js-interop.md` / `js-interop_ja.md` — normative JavaScript / TypeScript interoperability contract
- `standard-library.md` / `standard-library_ja.md` — Bytes, fixed-width integers, Unicode, and collections
- `runtime-abi.md` / `runtime-abi_ja.md` — Runtime ABI v2 contract between generated code and the Runtime
- `rules.json` — machine-checked mapping from specification rules to tests
