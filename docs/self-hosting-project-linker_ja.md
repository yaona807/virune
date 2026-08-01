# Project Linker

`project-linker.virune`は、canonical sourceごとのVirune製frontend ASTをproject dependency／export metadataへ変換する。

version 1 linkerは次を行う。

- `ImportDeclaration`／`ImportSource` nodeからVirune／JavaScript importを抽出する
- filesystemへアクセスせずrelative Virune module pathを解決する
- public top-level declarationを抽出する
- module／import重複、self import、参照先欠落、cycle、不正なrelative specifierを検証する
- entryからのreachable／unreachable moduleをcanonical request順で報告する

linkerはpureであり、project compiler境界から渡されたparser resultだけを使用する。filesystem discovery、canonical source ordering、JavaScript interop policyはHostが所有する。
