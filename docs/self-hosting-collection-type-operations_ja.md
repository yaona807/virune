# Self-host collection type operations

Collection型操作の段階では、Self-host data-type Checkerが生成したcanonical semantic arena上で純粋な型関係を評価します。Tuple、`List`、`Map`、`Set`、`Option`、`Result`の構造的関係に加え、`Never`／`Unknown`境界、optional lifting、alias透過、common type選択、再帰的な`Eq`／`Hash`／`Json`／`Debug` capability判定を扱います。

このmoduleはsemantic結果を意図的に文字列ベースのJSON contract経由で受け取ります。Typed semantic実装recordをmodule-privateに保ち、内部表現が意図せずmodule間APIになることを防ぎます。型操作結果も決定的なJSON境界から返します。

Newtypeはassignabilityでは名目的境界を維持し、underlying typeはcapability判定でのみ参照します。互換性のないcommon typeは`L2042`、存在しない操作対象は`L2040`になります。

対象検証:

```bash
npm run build
node --test --test-timeout=120000 packages/compiler/dist/test/selfhost-type-operations.test.js
```

この段階はProduction Checkerへ接続せず、grammar、stable Compiler API、Runtime ABI、Interop ABI、public standard libraryを変更しません。
