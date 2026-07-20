# JavaScript interop corpus

This corpus pins representative npm surfaces used to validate Virune's three-tier JavaScript interoperability model.

- Tier 1: conservative direct facade.
- Tier 2: compiled TypeScript adapter.
- Tier 3: unsafe escape hatch for untyped or dynamic APIs.

The corpus intentionally includes ESM, CommonJS with separate `@types`, generic overloads, foreign object handles, Promise values, conditional types, and callback-heavy APIs.
