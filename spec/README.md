# Virune 1.0 Normative Specification

[日本語版](README_ja.md)

The files in this directory define the normative language contract for Virune 1.0. When explanatory documentation and this directory disagree, this directory takes precedence. Runtime ABI details remain normative in [Runtime ABI v2](runtime-abi.md).

Each externally observable rule has a stable identifier such as `[type.nominal-identity]`. `rules.json` links core rules to conformance or integration tests. Editorial corrections may be made without changing the language; behavioral changes after 1.0 must follow the compatibility policy.

## Documents

- `grammar.ebnf` — complete normative grammar and newline-normalization contract
- [Lexical structure](lexical.md) — source encoding, tokens, comments, line termination
- [Documentation comments](documentation.md) — documentation comment association, Markdown, and diagnostics
- [Types](types.md) — type identity, inference, generics, nullability, capabilities
- [Evaluation and control flow](evaluation.md) — evaluation order, control flow, errors, cleanup
- [Modules and packages](modules.md) — modules, imports, visibility, re-exports, and platform targets
- [Executable entry point](entry-point.md) — executable `main` signature and exit behavior
- [Tasks and structured concurrency](tasks.md) — asynchronous execution and structured concurrency
- [JavaScript FFI](ffi.md) — JavaScript boundary rules
- [JavaScript interoperability model](js-interop.md) — normative JavaScript / TypeScript interoperability contract
- [Standard types and library contracts](standard-library.md) — Bytes, fixed-width integers, Unicode, collection semantics
- [Runtime ABI v2](runtime-abi.md) — Runtime ABI v2 contract between generated code and the Runtime
- `rules.json` — machine-checked specification-to-test mapping
