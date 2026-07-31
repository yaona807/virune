# Self-host module symbol visibility

[日本語](self-hosting-module-visibility_ja.md)

The module-visibility slice completes the bounded symbol scope／visibility stage after the canonical lexical scope arena. It models modules and module symbols as deterministic, contiguous arenas and validates access without loading files or resolving an actual project graph.

## Visibility rules

- Symbols remain separated into `value`, `type`, and `capability` namespaces.
- A private symbol is accessible from its defining module.
- Cross-module access requires the symbol to be public.
- A public API cannot reference a private nominal type in its signature.
- Builtin signature types are represented with a `null` module ID and do not create arena references.

Private cross-module access and private nominal exposure produce `L4010`. Unknown symbols or signature types produce `L2040`; duplicate modules or symbols produce `L1001`; malformed IDs, namespaces, kinds, or names produce `L9001`.

The JSON result contains canonical module and symbol IDs, resolved signature type IDs, access decisions, and deterministic diagnostics. Focused Host tests validate namespace isolation, same-module private access, cross-module public access, public API leakage, duplicate handling, malformed input, deterministic serialization, and reference integrity.

```bash
npm run build
node --test --test-timeout=120000 packages/compiler/dist/test/selfhost-module-visibility.test.js
```

This slice does not load a module graph, resolve import paths or re-export chains, connect the self-host checker to the Production Compiler, or change the grammar, stable Compiler API, Runtime ABI, Interop ABI, or public standard library.
