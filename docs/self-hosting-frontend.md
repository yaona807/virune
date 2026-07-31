# Self-hosting frontend

[日本語](self-hosting-frontend_ja.md)

The Virune-authored frontend is being expanded from the vertical MVP in bounded, mergeable stages. The first stage adds a complete lexical contract under `selfhost/mvp/src/frontend-model.virune` and `frontend-lexer.virune`. It remains isolated from the production compiler path.

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

## Documentation comments

Comments are not discarded. `//!` and exactly-three-slash `///` comments are classified separately from ordinary `//` and `////` comments. Their marker is removed, at most one following ASCII space is removed, and the normalized text and full source span are preserved for parser association in the next frontend stage.

## Verification

The regular Stage 0 self-host tests verify:

- deterministic token output;
- the complete keyword, literal, and operator vocabulary;
- documentation-comment classification;
- CRLF position tracking;
- soft-line normalization;
- malformed literal and reserved-character diagnostics;
- agreement with the Legacy Compiler on lexical rejection codes and starting positions.

This stage does not change the grammar, production parser, stable Compiler API, Runtime ABI, Interop ABI, or public standard library.
