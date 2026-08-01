# Bootstrap artifact snapshot

[English](self-hosting-bootstrap-snapshot.md) | [日本語](self-hosting-bootstrap-snapshot_ja.md)

Bootstrap artifact snapshot adapterは、実際の`buildProject`結果をversioned bootstrap artifact normalizerへ接続します。後続のStage 1／Stage 2比較に備えるStage 0の準備機能であり、新しいcompiler stageの生成やcompiler選択の変更は行いません。

## 収集するデータ

各emitted moduleについて、次を記録します。

- repository相対のJavaScript出力path
- 改行を正規化したgenerated JavaScript
- parseおよびcanonical化したsource map
- Virune Emitterが生成する有限なES module export形式
- JavaScriptとsource-map fileのSHA-256

また、diagnostic schemaと次の明示的metadataを記録します。

- stage（`stage0`、`stage1`、`stage2`）
- compiler version
- language versionとtarget platform
- Runtime ABI／Interop ABI version
- 任意の固定Seed SHA-256
- source-map設定

normalizationで無視するrun metadataは、versioned allowlistにある`generatedAt`と`runId`だけです。それ以外のmetadata差分は保持します。

## 安全条件

次の場合、snapshot作成を明示的に失敗させます。

- project buildにerror diagnosticがある
- moduleが1件もemitされていない
- emitted moduleのoutput metadataが不完全
- source mapが有効なJSONではない
- 必須version metadataが空
- Seed checksumがSHA-256ではない
- generated export syntaxがEmitterの有限な出力形式外

Adapterはfilesystemを読み取らず、generated JavaScriptも実行しません。`buildProject`が返したdataだけを使用します。

## 決定性smoke

Focused testでは、self-host MVPを独立したone-shot buildで2回buildします。run IDとtimestampが異なっても、serialized artifactとSHA-256は一致する必要があります。意味のあるJavaScript変更は、module sectionとchecksum sectionの両方に差分として残る必要があります。

## 対象外

この機能は次を行いません。

- Stage 1／Stage 2の生成
- bootstrap compiler facadeの呼び出し
- shadow／required CI gateの有効化
- production compiler defaultの変更
- grammar、stable Compiler API、Runtime ABI、Interop ABI、公開標準ライブラリの変更
