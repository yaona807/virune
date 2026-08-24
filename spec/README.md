# Virune 1.0 Language Specification

[日本語版](README_ja.md)

This directory is the normative language contract for Virune 1.0.

- [Lexical structure](lexical.md) — text encoding, tokens, comments, and statement termination
- [Documentation comments](documentation.md) — source documentation syntax and association rules
- [Types](types.md) — identity, inference, generics, absence, effects, mutation, and required-use values
- [Evaluation and control flow](evaluation.md) — evaluation order, arithmetic, matching, return, cleanup, panic, loops, and implicit `Unit` completion
- [Modules and packages](modules.md) — modules, imports, visibility, package resolution, public API snapshots, and platform execution
- [Executable entry point](entry-point.md) — the `main` contract used by `virune run`
- [Tasks and structured concurrency](tasks.md) — async execution, task lifetime, parallel operations, races, timeout/retry, and propagation precedence
- [JavaScript FFI](ffi.md) — explicit low-level JavaScript boundaries
- [JavaScript interoperability model](js-interop.md) — direct facades, compiled adapters, foreign values, bridges, ABI metadata, and trust boundaries
- [Standard types and library contracts](standard-library.md) — binary data, fixed-width integers, Unicode text, and value-keyed collections
- [Runtime ABI v2](runtime-abi.md) — runtime representation and public ABI rules

`grammar.ebnf` is the normative grammar artifact. `rules.json` maps stable rule IDs to the chapters and conformance tests that cover them.

When prose and implementation disagree, the discrepancy must be resolved before the behavior is treated as stable. Behavioral changes after 1.0 must follow the [compatibility policy](../COMPATIBILITY.md); green tests or snapshot updates alone do not override this specification.
