# Diagnostic codeとJSON schema

[English](diagnostic-codes.md) | [日本語](diagnostic-codes_ja.md)

Virune diagnosticは、安定したshort codeとqualified codeを持ちます。

- Short code: `L2043`
- Qualified code: `virune/L2043`
- LSP source: `virune`

既存の`Lxxxx` codeは互換性のため変更しません。外部toolはmessage textではなく、`source`と`code`の組み合わせ、または`qualifiedCode`を比較してください。

## Code range

| Range | Category | 意味 |
| --- | --- | --- |
| `L0000`–`L0999` | `syntax` | Lexing、parsing、syntax、source documentation |
| `L1000`–`L1999` | `binding` | Declaration、name、symbol、visibility |
| `L2000`–`L2999` | `type-system` | Type、effect、call、value compatibility |
| `L3000`–`L3999` | `control-flow` | Control flow、exhaustiveness、ownership、reachability |
| `L4000`–`L4999` | `module` | Project configuration、module graph、JavaScript interop |
| `L5000`–`L5999` | `entry-point` | CLIとexecutable entry-point validation |
| `L9000`–`L9999` | `internal` | Unknownまたはinternal compiler／tool failure |

新しいcodeは、該当range内で単調増加するよう採番します。一度公開したcodeを別のsemantic conditionへ再利用しません。

## Severity model

安定したseverity valueは次の4つです。

- `error`: compileまたは要求された操作を完了できない
- `warning`: 操作は完了できるが、欠陥またはportability riskの可能性が高い
- `information`: 処理を妨げない説明情報
- `hint`: 処理を妨げない改善提案または案内

Compiler API、CLI JSON出力、LSP mappingは同じvalueを使用します。LSPではそれぞれError、Warning、Information、Hintへ対応します。

## JSON diagnostics

次を使用します。

```bash
virune check . --diagnostic-format=json
```

出力は`schemaVersion: 1`のdocumentです。公開JSON Schemaはcompiler packageから次のpathで参照できます。

```text
@virune/compiler/diagnostics.schema.json
```

例:

```json
{
  "schemaVersion": 1,
  "diagnostics": [
    {
      "source": "virune",
      "code": "L2043",
      "qualifiedCode": "virune/L2043",
      "category": "type-system",
      "severity": "error",
      "message": "Expected String but received Int",
      "file": "src/main.virune",
      "range": {
        "start": { "line": 2, "column": 9 },
        "end": { "line": 2, "column": 10 }
      },
      "related": [],
      "help": null,
      "fixIds": [],
      "cause": null
    }
  ]
}
```

lineとcolumnは1-basedです。`related` entryは、それぞれ独自のfileとrangeを持ちます。`fixIds`はcompiler fixとeditor code actionを対応付けるための安定identifierです。internal diagnosticは、`kind`、`message`、任意の`name`と`stack`を持つstructured `cause`を含められます。

## 現在のcode catalog

正確な現在のcode一覧はcompiler／CLI sourceから生成します。repository checkoutで次を実行してください。

```bash
node scripts/diagnostic-catalog.mjs
node scripts/diagnostic-catalog.mjs --json
```

CIも同じcatalog scannerを実行し、production source内の不正形式、未分類、非literalなdiagnostic codeを拒否します。

代表的なcode:

| Code | 意味 |
| --- | --- |
| `L0001` | 不正なtokenまたはcharacter sequence |
| `L0002` | Sourceがgrammarに一致しない |
| `L2043` | Valueが要求typeと互換でない |
| `L3004` | Match expressionがexhaustiveでない |
| `L4002` | Module dependency graphにcycleがある |
| `L5010` | Executable entry moduleまたはoutputを利用できない |
| `L9001` | Parsing後のAST constructionに失敗した |

code固有の説明がある場合は、`virune explain <code>`で簡潔な説明を確認できます。

## 互換性方針

schema version 1内で、次の変更はnon-breakingです。

- messageの表現、句読点、追加context
- field typeを維持した`related`、`help`、`fixIds`、`cause`内容の追加
- 新しいsemantic conditionに対する新codeの追加

次の変更には明示的な互換性reviewが必要で、通常はlanguageまたはschemaのmajor version変更を要求します。

- 公開済みcodeの削除または再利用
- codeのsemantic meaning変更
- 同じconditionに対するseverity変更
- range coordinate、indexing rule、必須JSON fieldの変更
- structured fieldのtypeまたは意味の変更

Toolはmessage textを安定identifierとして使用してはいけません。`schemaVersion`を確認してからparseし、将来追加される未知のcodeを許容してください。
