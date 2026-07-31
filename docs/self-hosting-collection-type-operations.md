# Self-host collection type operations

[日本語](self-hosting-collection-type-operations_ja.md)

The collection type-operation slice runs over the canonical semantic arena produced by the self-host data-type checker. It supports structural relations for tuples, `List`, `Map`, `Set`, `Option`, and `Result`, together with `Never`／`Unknown` boundaries, optional lifting, alias transparency, common-type selection, and recursive `Eq`／`Hash`／`Json`／`Debug` capability checks.

The module deliberately consumes the semantic result through the string-based JSON contract. Typed semantic implementation records remain private to their module, preventing an internal representation from becoming an accidental cross-module API. The returned operation result is also encoded through a deterministic JSON boundary.

Newtypes remain nominal for assignability. Their underlying types participate only in capability evaluation. Incompatible common types produce `L2042`; missing operation targets produce `L2040`.

Focused validation:

```bash
npm run build
node --test --test-timeout=120000 packages/compiler/dist/test/selfhost-type-operations.test.js
```

This slice is not connected to the Production Checker and does not change the grammar, stable Compiler API, Runtime ABI, Interop ABI, or public standard library.
