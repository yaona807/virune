# Virune 1.0 Normative Specification

[English](README.md) | [日本語](README_ja.md)

The files in this directory define the normative language contract for Virune 1.0. When explanatory documentation and this directory disagree, this directory takes precedence. Runtime ABI details remain normative in `docs/runtime-abi.md`.

Each externally observable rule has a stable identifier such as `[type.nominal-identity]`. `rules.json` links core rules to conformance or integration tests. Editorial corrections may be made without changing the language; behavioral changes after 1.0 must follow the compatibility policy.

For a learning-oriented introduction, see the [language guide](../docs/language-guide.md).

## Documents

- `grammar.ebnf` — complete normative grammar and newline-normalization contract
- `lexical.md` — source encoding, tokens, comments, line termination
- `types.md` — type identity, inference, generics, nullability, capabilities
- `evaluation.md` — evaluation order, control flow, errors, cleanup
- `modules.md` — modules, imports, visibility, re-exports, and platform targets
- `entry-point.md` — executable `main` signature and exit behavior
- `tasks.md` — asynchronous execution and structured concurrency
- `ffi.md` — JavaScript boundary rules
- `standard-library.md` — Bytes, fixed-width integers, Unicode, collection semantics
- `rules.json` — machine-checked specification-to-test mapping
