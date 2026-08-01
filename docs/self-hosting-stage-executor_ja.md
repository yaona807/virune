# Bootstrap Stage Executor

`bootstrap-stage-executor.ts`は、Virune製project compilerがreadyになった後にStage 1／Stage 2を実行する、決定的なHost側境界である。

executorは次を行う。

1. Stage 0 compilerでcanonical project inputをcompileする
2. 生成されたStage 1 module集合を正規化する
3. 注入されたloaderでStage 1 artifactをloadする
4. 同じinputをStage 2へ再compileする
5. 正規化artifact hashとmodule別hashを比較する

hash対象payloadからstage名を除外し、CRLF／CRはLFへ正規化する。追加・削除・変更されたoutput moduleはoutput path順で報告する。

このmoduleはProduction Compiler routeを変更せず、filesystem accessも直接行わない。materializeとmodule loadはcallerが所有する。
