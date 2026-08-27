# Virune 1.0 Normative Specification

[日本語版](README_ja.md)

The files in this `spec/` directory define the normative language contract for Virune 1.0. If explanatory documentation elsewhere conflicts with this directory, this specification takes precedence. [Runtime ABI v2](runtime-abi.md) is normative for Runtime ABI details.

Each externally observable rule has a stable ID such as `[type.nominal-identity]`. `npm run spec:check` discovers rule IDs from the paired English/Japanese normative documents and binds them to executable evidence declared by conformance expectations or repository-owned test/verifier annotations. Editorial corrections that do not change language behavior may be made, but behavioral changes after Virune 1.0 must follow the [compatibility policy](../COMPATIBILITY.md).

## Documents

- `grammar.ebnf` — complete normative grammar and newline-normalization contract
- [Lexical structure](lexical.md) — source encoding, tokens, comments, and statement termination
- [Documentation comments](documentation.md) — documentation-comment association, Markdown, and diagnostics
- [Types](types.md) — type identity, inference, generics, nullability, and capabilities
- [Evaluation and control flow](evaluation.md) — evaluation order, control flow, errors, and cleanup
- [Modules and packages](modules.md) — modules, imports, visibility, re-exports, and platform targets
- [Executable entry point](entry-point.md) — executable `main` signature and exit behavior
- [Tasks and structured concurrency](tasks.md) — asynchronous execution and structured concurrency
- [JavaScript FFI](ffi.md) — JavaScript boundary rules
- [JavaScript interoperability model](js-interop.md) — normative JavaScript / TypeScript interoperability contract
- [Standard types and library contracts](standard-library.md) — `Bytes`, fixed-width integers, Unicode, and collection semantics
- [Runtime ABI v2](runtime-abi.md) — Runtime ABI v2 contract between generated code and the Runtime
