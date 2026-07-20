# Lexical Structure

[English](lexical.md) | [日本語](lexical_ja.md)

## `[lexical.encoding]` UTF-8
Virune source files are UTF-8. Identifiers use ASCII letters, digits, and underscore; an identifier cannot start with a digit. `$` is reserved for compiler-generated identifiers.

## `[lexical.comments]` Comments
`//` starts a line comment. `///` is a documentation comment. Block comments are not part of Virune 1.0.

## `[lexical.statement-end]` Statement termination
Semicolons are not tokens. A hard line break terminates a statement. Line breaks inside parentheses or brackets, after commas, and adjacent to continuation operators are soft. The canonical formatter decides the final layout.

## `[lexical.string]` Strings
Strings use double quotes. Interpolation uses `{expression}`. `{{` and `}}` represent literal braces. String operations are defined over Unicode code points unless an API explicitly says otherwise.

## `[lexical.number]` Numbers
`Int` literals must be JavaScript safe integers. `BigInt` literals end in `n`. `Float` follows IEEE 754 binary64. Numeric types never convert implicitly.
