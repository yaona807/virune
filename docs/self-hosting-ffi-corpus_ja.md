# Versioned self-host FFI corpus

FFI境界Checkerを、versioned manifestを持つrepository-owned corpusで継続検証する。

corpusはsafe boundary、extern policy、`@jsExport`、malformed arena、diagnostic順序の代表例を固定する。各caseを2回評価し、byte-identicalなserialization、連番result ID、bounded diagnostic、diagnostic参照の有効性を検証する。

このcorpusはFFI意味論変更、JavaScript実行、module解決、Production Compilerへの接続を行わない。既に実装済みのHost–Kernel contractを固定し、後続のsemantic differentialで安定したinput／outputを比較できるようにする。
