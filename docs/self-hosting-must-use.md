# Self-host local must-use analysis

[日本語](self-hosting-must-use_ja.md)

The self-host checker classifies local must-use types and explicit value-consumption decisions before expression inference and control-flow checking are connected.

## Supported must-use sources

The isolated JSON contract combines the flat frontend AST and canonical semantic arena to classify:

- local records, enums, and newtypes annotated with `@mustUse`;
- `Result<T, E>` values;
- type aliases that recursively resolve to either source.

Declaration handles preserve their canonical named type IDs before following aliases. This keeps newtypes nominal and allows the result to distinguish direct attributes, aliases, and `Result` as separate must-use reasons.

`Future<T>`, foreign snapshot metadata, and standard-library resource types such as `Stream`, `FileHandle`, and `MutableBytes` remain assigned to later async, interop, and standard-library migration slices.

## Attribute validation

- `@mustUse` is accepted only on record, enum, and newtype declarations.
- An unsupported target produces `L2090`.
- Any argument produces `L2091`.
- An otherwise valid annotated declaration remains classified as must-use even when its attribute also carries invalid arguments, matching the Legacy checker model.

## Value consumption

The contract accepts an explicit disposition for each canonical type handle:

- `expression`: ignored expression value;
- `bind`;
- `return`;
- `discard`;
- `await`;
- `handle`.

A must-use value with the `expression` disposition produces `L2097`. The other five dispositions are explicit consumption. Unknown dispositions produce bounded `L9001` diagnostics, and unknown type handles produce `L2040` instead of panicking.

The result returns the canonical type ID, classification reason, consumption decision, annotated declaration IDs, and diagnostics. Repeating the same request must serialize identically. Only the string-based JSON adapter is public; parser, semantic, request, and result records remain module-private at this stage boundary.

## Validation

```bash
npm run build
node --test --test-timeout=120000 packages/compiler/dist/test/selfhost-must-use.test.js
```

This slice does not infer expression types, connect to the Production Checker, or change the grammar, stable Compiler API, Runtime ABI, Interop ABI, or public standard library.
