# Self-host symbol scope arena

[日本語](self-hosting-symbol-scope_ja.md)

The self-host checker models lexical scopes and symbols as deterministic data-only arenas before expression type checking is connected.

## Scope model

- Scope IDs are contiguous and assigned in request order.
- Supported scope kinds are `module`, `function`, and `block`.
- A module scope has no parent.
- Function and block scopes reference an earlier scope, which makes the parent graph acyclic by construction.
- Every scope records the canonical AST node ID that owns it.

## Symbol model

Symbols are separated into `value`, `type`, and `capability` namespaces. The same spelling may exist in different namespaces without conflict. A duplicate in the same scope and namespace produces `L1001` and is not added to the arena.

A symbol may shadow the nearest symbol with the same name and namespace in an enclosing scope. The relationship is recorded as `shadowsSymbolId`; shadowing is not treated as a same-scope duplicate.

## Lookup

Lookup starts in the requested scope and walks parent scopes until it finds the nearest matching namespace and name. Unknown symbols produce `L2040`. Invalid scope references, namespace values, owner IDs, source IDs, or cyclic parent attempts produce `L9001` diagnostics instead of panicking.

The focused Host test verifies deterministic serialization, contiguous IDs, parent references, namespace isolation, shadowing, nearest lookup, duplicate rejection, and malformed input handling.

```bash
npm run build
node --test --test-timeout=120000 packages/compiler/dist/test/selfhost-symbol-scope.test.js
```

This slice does not implement multi-module visibility or connect the self-host arena to the Production Checker. It does not change the grammar, stable Compiler API, Runtime ABI, Interop ABI, or public standard library.
