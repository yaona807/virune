# Self-hosting frontend

[日本語](self-hosting-frontend_ja.md)

The Virune-authored frontend is being expanded from the vertical MVP in bounded, mergeable stages. It remains isolated from the production compiler path.

## Lexical contract

The frontend lexer emits canonical JSON containing:

- normalized tokens with source positions and spans;
- ordinary, declaration-documentation, and module-documentation comments;
- stable lexical diagnostics.

The token vocabulary covers all Virune 1.0 keywords, identifiers, decimal/hex/binary integers, BigInt and Float literals, strings, punctuation, operators, physical line ends, and EOF.

## Newline normalization

The lexer applies the normative soft-line rules from `spec/grammar.ebnf` before returning tokens:

- line ends inside parentheses or brackets are removed;
- line ends adjacent to continuation operators are removed;
- braces do not suppress line ends;
- the top-level generic-declaration exception after `>` is retained.

CRLF and LF inputs produce the same logical line progression while preserving source offsets and spans.

## Parser core

The parser core consumes the validated lexer JSON and writes a canonical flat AST arena. Nodes use integer IDs and child-ID lists rather than recursive JavaScript object graphs. Append order defines node IDs, so identical input produces identical serialization.

The current parser foundation includes:

- module, unsafe-module, import, attribute, and declaration envelopes;
- function declarations and nested blocks;
- `let`, `return`, `discard`, `defer`, assignment, loop, and conditional statement structure;
- precedence-aware binary expressions;
- unary, call, field, try, and record-update postfix structure;
- balanced transport nodes for declaration bodies and complex expression forms;
- a depth limit and newline/declaration synchronization for malformed input.

This core is intentionally a foundation. Record fields, enum variants, patterns, lambda internals, and every type-reference form will be expanded into detailed nodes in later bounded parser changes before Issue #96 can close.

## Documentation comments

Comments are not discarded. `//!` and exactly-three-slash `///` comments are classified separately from ordinary `//` and `////` comments. Their marker is removed, at most one following ASCII space is removed, and the normalized text and full source span are preserved.

The parser attaches module documentation to the module node and declaration documentation to supported declaration nodes. Unsupported, late, or unattached groups produce the existing `L0010`–`L0012` diagnostics.

## Verification

The regular Stage 0 self-host tests verify:

- deterministic token and AST output;
- the complete keyword, literal, and operator vocabulary;
- documentation-comment classification and association;
- CRLF position tracking;
- soft-line normalization;
- malformed literal and reserved-character diagnostics;
- flat-arena ID and child-reference integrity;
- parser recovery that reaches declarations following malformed input;
- agreement with the Legacy Compiler on lexical rejection and supported-source acceptance.

This work does not change the grammar, production parser, stable Compiler API, Runtime ABI, Interop ABI, or public standard library.
