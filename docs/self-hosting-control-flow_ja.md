# Self-host control-flow termination

[English](self-hosting-control-flow.md)

Control-flow sliceは、決定的なflat flow-node arena上でboundedなLegacy termination analysisを再現します。Parent nodeは後続node IDのみを参照するため、arenaは構造上acyclicです。

## Termination rule

- `return`、`break`、`continue`は現在のpathを終端します。
- Expression／discard nodeはinferred typeが`Never`の場合に終端します。
- `if`はthen／elseの両branchが終端する場合だけ終端します。
- `while true`はbodyが終端する場合に終端します。
- false／dynamic whileとすべてのfor loopは終端を保証しません。
- Blockは最初の終端statement以降をunreachableとして記録し、そのunreachable subtreeは走査しません。

非`Unit`functionが全pathで終端しない場合は`L3001`です。Unreachable statementごとに`L3006`を返します。Duplicate function entryは`L1001`、不正なnode kind、child layout、順序、参照、name、bodyは`L9001`になります。

JSON resultは連番node／function ID、all-path termination判定、unreachable node ID、決定的diagnosticを返します。

```bash
npm run build
node --test --test-timeout=120000 packages/compiler/dist/test/selfhost-control-flow.test.js
```

このsliceはexpression／return type推論、より深いloop escape analysis、try／catch、defer、async／await、structured concurrency semanticsを実装しません。Self-host CheckerをProduction Compilerへ接続せず、grammar、stable Compiler API、Runtime ABI、Interop ABI、public standard libraryも変更しません。
