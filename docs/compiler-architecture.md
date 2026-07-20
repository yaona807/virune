# Compiler architecture

[日本語](compiler-architecture_ja.md)

The compiler pipeline is:

1. lexer and parser;
2. CST-to-AST conversion;
3. project and module graph construction;
4. declaration collection and nominal identity assignment;
5. type, effect, control-flow, must-use, FFI, and entry-point checking;
6. HIR/MIR lowering;
7. ES2022 and source-map emission.

Important implementation boundaries:

- `syntax` owns grammar and source spans;
- `ast` contains only user-visible language declarations;
- `checker/type-operations.ts` owns assignability, structural Eq/Hash support, derive support, generic unification, and substitution;
- `checker/effect-registry.ts` contains the closed built-in effect set;
- the checker enforces non-escaping `uses *` callbacks;
- no protocol or implementation registry exists;
- `codegen` emits Runtime ABI v2 and Interop ABI v2 descriptors;
- project identity is based on package, module, and declaration IDs rather than names;
- unsupported FFI shapes are deliberately represented as `Unknown` instead of receiving optimistic descriptors.

The stable compiler API excludes internal AST, HIR, MIR, arenas, and semantic tables. Experimental exports may change during alpha releases.
