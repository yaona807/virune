# セルフホストShadow Report

[English](self-hosting-shadow-report.md) | [日本語](self-hosting-shadow-report_ja.md)

Bootstrap shadow reportは、2つの正規化済みbootstrap artifactを、決定的かつupload可能なevidenceへ変換します。後続のNightly shadow executionで利用するための機能であり、version 1では意図的にnon-blockingです。

## 比較コントラクト

Reportには次を格納します。

- baseline／candidateのlabel、stage、compiler version、artifact SHA-256
- 正規化artifact自体が完全一致したか
- 期待される差分
- sectionとfield pathを保持した予期しない差分
- section単位の差分件数
- 決定的JSON serializationとreport SHA-256

期待差分として扱うのは`metadata.stage`だけです。さらに、差分値が宣言されたbaseline stageとcandidate stageに正確に一致する場合だけ許容します。Generated JavaScript、source map、module order、exports、diagnostic schema、ABI metadata、checksum、その他のmetadata差分は一切無視しません。

## Status

- `equivalent`: 予期しない差分が存在しない。`metadata.stage`によりraw artifactは異なる場合がある。
- `mismatch`: 予期しない差分が1件以上存在する。

Report version 1の`blocking`は常に`false`です。Reportはevidenceであり、branch protectionの判定でもproduction compiler切替許可でもありません。

## 整合性と決定性

Reporterは、入力artifactのSHA-256がserialized contentと一致すること、およびstructured artifactがserializationと一致することを確認します。不正または改ざんされた入力はfail-closedで拒否します。

差分はsection、field path、before、afterの順でsortします。Section summaryもsection名順に固定します。同じ入力からはバイト単位で同じreport JSONとSHA-256が生成されます。

## 現在の境界

この機能はStage 1／Stage 2を実行せず、Nightly workflow、required gate、branch protection、compiler選択、fixed Seed、stable Compiler API、Runtime ABI、Interop ABI、grammar、公開standard libraryを変更しません。
