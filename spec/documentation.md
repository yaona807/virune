# Documentation Comments

[English](documentation.md) | [日本語](documentation_ja.md)

## `[documentation.kinds]` Comment kinds

Virune distinguishes three line-comment forms:

```virune
// Ordinary comment
/// Documentation for the following declaration
//! Documentation for the current source module
```

`///` means exactly three slash characters followed by any character other than `/`. `////` is an ordinary line comment. Virune 1.0 has no block-comment or block-documentation syntax.

## `[documentation.module]` Module documentation

A consecutive group of `//!` lines documents the current source module. It must appear at the beginning of the file, before imports, attributes, declarations, or other comments. Leading whitespace and blank lines are allowed. A source module may have only one module-documentation group.

## `[documentation.declaration]` Declaration documentation

A consecutive group of `///` lines documents the next supported declaration. `///` must be the first non-whitespace content on each line. Blank lines and declaration attributes may appear between the group and the declaration. An ordinary comment or any other token ends the association.

Documentation comments may be attached to:

- functions;
- records and record fields;
- enums and enum variants;
- newtypes and type aliases;
- top-level `let` and `const` declarations;
- extern blocks and extern functions.

They cannot be attached to imports, tests, parameters, local variables, statements, or expressions. An unattached or unsupported documentation comment is a compile-time error.

## `[documentation.normalization]` Text normalization

For each line, the marker is removed and at most one immediately following ASCII space is removed. The remaining lines are joined with LF. Leading and trailing empty documentation lines are removed. The source span of the complete comment group is preserved.

The formatter writes a single ASCII space after a non-empty `///` or `//!` marker and does not reflow the Markdown body.

## `[documentation.markdown]` Markdown

Documentation text is CommonMark 0.31.2-compatible Markdown. Raw HTML is not rendered by official tooling. The first paragraph is the summary used by completion and symbol-oriented UI; Hover and generated documentation may show the complete text.

Standard headings such as `Parameters`, `Returns`, `Errors`, `Panics`, `Safety`, and `Examples` are conventions, not language syntax. Virune 1.0 does not assign special meaning to `@param`, `@return`, XML tags, or heading names.

## `[documentation.semantics]` Compilation semantics

Documentation is retained in the AST as normalized text. It does not affect name resolution, type checking, JavaScript emission, Runtime ABI, or the stable API compatibility snapshot.

Official editor tooling exposes documentation through Hover, completion, Signature Help, snippets, and documentation-generation Code Actions.

## `[documentation.diagnostics]` Diagnostics

| Code | Condition |
|---|---|
| `L0010` | A `///` group is not attached to a supported declaration. |
| `L0011` | A `//!` group is not at the beginning of the file. |
| `L0012` | A `///` group targets an unsupported construct. |
| `L0013` | A module or declaration has multiple documentation groups. |
