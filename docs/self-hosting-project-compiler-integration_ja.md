# Project Compiler Integration

`project-compiler-contract.virune`は、Virune製frontend、project linker、semantic context、lowering pipeline、deterministic project emitterを1つのversioned boundaryへ統合する。

canonical self-host source集合では、境界全体について次を検証する。

1. 31件すべてのcanonical sourceをparseする
2. 31 moduleすべてをcheckする
3. compiler diagnosticが0件である
4. 31 moduleすべてをcanonical順でemitする
5. project compileを繰り返しても構造化結果がbyte単位で一致する

このためcapabilityは`ready: true`かつblockerなしを返す。このreadiness claimはStage 1／Stage 2 bootstrap生成に限定される。Production compilerの切替、fixed Seed更新、互換性gateの緩和、release昇格の承認は行わない。

parser、linker、semantic、lowering、emissionの失敗はpath-awareかつfail-closedを維持する。受理されたmoduleは決定的なruntime importとmetadataを持ち、`.selfhost-output/`へemitされる。
