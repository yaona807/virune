# Full-language Lowering Inventory

`selfhost-full-language-inventory.test.ts`は、canonicalなViruneセルフホストsource setを生成済みStage 0 project compilerへ投入し、決定的なdiagnostic inventoryを1件出力する。

inventoryはdiagnosticをcodeとmessageで集約し、発生件数と該当source pathのソート済み集合を記録する。次を検証する。

- 生成済みcompilerが明示的な`full-language-lowering-not-implemented` capability blockerを維持している
- canonical sourceをすべてparseする
- 現在のfull self-host projectはfail-closedのままである
- 反復compileのresultとinventoryが完全一致する
- 廃止済みの`SHP2001` project-linking placeholderが再発しない

CI logには`SELFHOST_FULL_LANGUAGE_INVENTORY`で始まるmachine-readable JSONを出力する。このJSONを、declaration、expression／control-flow、effect／async、runtime／deriveの独立レーンへfull-language loweringを分割する入力として使う。full source setが受理可能になった時点で、このtestは削除または成功条件へ反転する。
