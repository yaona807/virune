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

The parser core consumes the validated lexer JSON and writes a canonical flat AST arena. The internal Lexer–Parser call uses a non-`@jsExport` JSON function. As in the existing MVP pipeline, JSON text is parsed with `Json.parse` before the resulting JSON value is decoded as `FrontendLexResult`. `@jsExport` remains limited to the Host-facing contract. Nodes use integer IDs and child-ID lists rather than recursive JavaScript object graphs. Append order defines node IDs, so identical input produces identical serialization.

The current parser foundation includes:

- module, unsafe-module, import, attribute, and declaration envelopes;
- function declarations and nested blocks;
- `let`, `return`, `discard`, `defer`, assignment, loop, and conditional statement structure;
- precedence-aware binary expressions;
- unary, call, field, try, and record-update postfix structure;
- a depth limit and newline/declaration synchronization for malformed input.

## Detailed declarations and types

Record, enum, newtype, and type-alias declarations are expanded by a separate Virune-authored parser module. Its result is merged into the existing arena with absolute node IDs, so every child reference remains valid after integration.

The detailed declaration slice emits:

- `TypeParameters` and `TypeParameter` nodes;
- `RecordBody` and individual `RecordField` nodes;
- `EnumBody` and individual `EnumVariant` nodes with payload child types;
- underlying type children for newtype and type aliases;
- named, generic, tuple, function, list, and optional type-reference nodes.

Malformed fields, variants, generic arguments, and underlying types produce stable parser diagnostics while preserving progress to following declarations. If an unclosed enum payload suppresses its physical newline during lexical normalization, source line positions terminate recovery before the next variant is consumed.

## Match expressions and patterns

`MatchExpression` uses the existing precedence-aware expression parser for the target, optional guards, and arm bodies. A separate Virune-authored pattern module parses each arm pattern and returns data-only JSON containing absolute arena node IDs.

The pattern slice emits:

- `MatchArm` nodes with pattern, optional guard, and body children;
- wildcard, identifier, literal, and inclusive-range pattern nodes;
- list, tuple, and rest pattern nodes;
- variant and record pattern nodes, including record fields and record rest;
- canonical `OrPattern` nodes for alternative patterns.

Pattern nesting is bounded. A malformed pattern or missing `=>` produces a stable parser diagnostic and synchronizes at a physical line end or the enclosing `}`. A progress guard prevents malformed arms from hanging the parser. Lambda internals and remaining grammar families stay in later bounded slices before Issue #96 can close.

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
- detailed record, enum, newtype, type-alias, and nested type-reference nodes;
- guarded match arms and nested pattern families;
- recovery from malformed declaration details and match arms to following functions;
- agreement with the Legacy Compiler on lexical rejection and supported-source acceptance.

This work does not change the grammar, production parser, stable Compiler API, Runtime ABI, Interop ABI, or public standard library.
