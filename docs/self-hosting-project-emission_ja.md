# Project Emitter

`project-emitter.virune`は、検証済みproject semanticsとStage 1 artifactの間に置く決定的assembly境界である。

version 1 requestはcanonicalなmodule順、正規化済み1行preamble／statement、source map text、dependency metadata、exported-symbol metadataを受け取る。emitterは安定したgenerated headerとLF終端を付加し、metadataを維持する。path重複、複数行entry、entry欠落、CRを含むsource mapはfail closedにする。

moduleはpureかつfilesystem-freeである。output path選択とJavaScript statement生成は、project compiler統合sliceがcanonical lowering pipelineへ接続するまで明示的inputとして維持する。
