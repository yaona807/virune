# Compiler architecture

[English](compiler-architecture.md)

Compiler pipelineは次の順序です。

1. LexerとParser
2. CSTからASTへの変換
3. Project／module graph構築
4. Declaration収集とnominal identity割当
5. 型、effect、control flow、must-use、FFI、entry point検査
6. HIR／MIR lowering
7. ES2022とSource Map出力

主な責務境界：

- `syntax`はgrammarとsource spanを管理します。
- `ast`には利用者に見える言語宣言だけを置きます。
- `checker/type-operations.ts`はassignability、構造的Eq／Hash対応、derive、generic unification、substitutionを管理します。
- `checker/effect-registry.ts`は閉じた組み込みeffect集合を管理します。
- Checkerは`uses *` callbackの非escape制約を検査します。
- Protocol／implementation registryはありません。
- `codegen`はRuntime ABI v2とInterop ABI v2 descriptorを出力します。
- Project identityは名前ではなくpackage、module、declaration IDで決まります。
- 対応できないFFI型には楽観的descriptorを付けず`Unknown`として扱います。

Stable Compiler APIは内部AST、HIR、MIR、arena、semantic tableを公開しません。Experimental exportはalpha期間中に変更される可能性があります。
