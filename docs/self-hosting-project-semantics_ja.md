# Project Semantic Context

`project-semantic.virune`は、module linking後かつ決定的emit前に使用するproject-wide semantic adapterである。

version 1のfixture contractは次を検証する。

- module pathとsymbol nameの一意性
- 参照先module／symbolの存在
- module間visibility
- 参照元moduleでのeffect利用可否

diagnosticはcanonicalなmodule／reference順で決定的に生成する。adapterはfilesystemへアクセスせず、正規化済みproject dataだけを受け取るため、path／I/O境界はHostが所有する。
