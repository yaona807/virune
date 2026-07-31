# Bootstrap artifact normalization

Bootstrapの決定性は、versionedで明示的なnormalization policyを適用した後のStage 1／Stage 2を比較して判定します。このmoduleはStage 1／2 driverへ接続する前に、その基盤を固定します。

## Policy v1

Normalizerはgenerated JavaScript module、source map、module export、diagnostic schema、build metadata、checksum manifestを受け取ります。

次をcanonical化します。

- repository相対pathとpath separator
- module、export、checksum、JSON object keyの順序
- generated JavaScriptのCRLF／CRをLFへ統一
- source mapの`file`／`sources` path
- SHA-256の大文字・小文字

それ以外のgenerated JavaScript内容、source map mapping／content、export、diagnostic schema field、metadata、checksum値は意味のある差分として保持します。

## 明示的な非決定metadata

Policy v1で無視するのは、top-level metadataの次のfieldだけです。

- `generatedAt`
- `runId`

Normalized artifact自身が`policy.ignoredMetadataFields`へallowlistを記録します。未知のfieldやnested fieldを暗黙には削除しません。その他のmetadata追加・変更はnormalized hashを変化させ、field-level diffへ表示されます。

## Validation

Unsupported policy version、設定root外へ出るpath、canonical化後に重複するmodule／checksum path、duplicate export、不正SHA-256、undefined JSON field、非有限numberをrejectします。

出力は次のとおりです。

- canonical artifact data
- stable serialized representation
- SHA-256 digest
- 2つのnormalized artifact間のsection／field-level diff

Focused validation:

```bash
npm run build
node --test packages/compiler/dist/test/selfhost-bootstrap-artifact-normalizer.test.js
```

この基盤はStage 1／Stage 2を生成せず、既存release gateを変更せず、required shadowを有効化せず、Production compilerを切り替えません。
