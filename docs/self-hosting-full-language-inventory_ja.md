# Full-language Lowering Inventory

`selfhost-full-language-inventory.test.ts`は、canonicalなViruneセルフホストsource setを生成済みStage 0 project compilerへ投入し、決定的なdiagnostic inventoryを1件出力する。

inventoryはdiagnosticをcodeとmessageで集約し、発生件数と該当source pathのソート済み集合を記録する。さらに、生成結果の契約違反を`boundaryBlockers`へ記録する。次を検証する。

- 生成済みcompilerが明示的な`full-language-lowering-not-implemented` capability blockerを維持している
- canonical sourceをすべてparse・checkする
- 現在のfull self-host projectはfail-closedのままである
- raw project compileを反復してもresultとinventoryが完全一致する
- 廃止済みの`SHP2001` project-linking placeholderが再発しない
- dependencyとexported-symbol metadataがcanonicalなtuple順で出力される

project linkerはdependency metadataを`(modulePath, sourceKind, specifier)`、exported symbolを`(modulePath, name, declarationKind)`でcanonical化する。これによりproject module、import、declarationの入力順が公開metadataの結果を変えない。`boundaryBlockers`の期待値は空配列であり、今後値が入った場合はfull-language lowering diagnosticではなくproject compiler boundaryの回帰として扱う。

決定的なJSON evidenceは`.cache/ci-timings/selfhost-full-language-inventory.json`へ書き出す。既存のcore-test evidence uploadはこのdirectoryを含むため、`--failure-output-only`が成功したunit testのstdoutを抑制しても、CI artifactからinventoryを回収できる。出力抑制なしでtestを実行した場合は、`SELFHOST_FULL_LANGUAGE_INVENTORY`で始まる行も出力する。

project metadataのcanonical化後に残る実測diagnosticは、Pure Core MVP lexer／parserで未対応の記号とdeclaration形式に属する。このmachine-readable JSONを、declaration／type、expression／control-flow、effect／async、runtime／deriveの独立レーンへ残作業を分割する入力として使う。各blockerの解消とfull source setの受理に応じて、このtestは削除または成功条件へ反転する。
