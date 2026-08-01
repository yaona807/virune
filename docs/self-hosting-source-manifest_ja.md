# セルフホスティング用source manifest

この文書は、実験的なセルフホスティングのHost–Kernel境界で使用するsource manifest version 1を定義します。

## 目的

Hostは、ファイルシステム、エディタ、アーカイブなどからsourceを取得します。Compiler KernelやInterop resolution evidenceがそのsourceへ依存する前に、完全なsource集合を一意に表す決定論的な識別子が必要です。

`createKernelSourceManifest`は、検証済みの`KernelInputV1`をdata-only manifestとproject-level SHA-256へ変換します。manifestにはsource本文やHost objectを格納しません。

## 正規化

実装は次の順序で処理します。

1. 既存のKernel contractでinputを検証する
2. contractが正規化したproject-relative pathを使用する
3. hashとbyte数の計算前にCRLF／CRをLFへ正規化する
4. Unicodeや末尾空白を含む、それ以外のsource byteは変更しない
5. source entryをcanonical path順に並べる
6. sourceごとのSHA-256、正規化後UTF-8 byte数、行数を記録する
7. 固定されたversion 1形式を`JSON.stringify`で直列化する
8. 直列化結果からproject-level SHA-256を計算する

このため、sourceの入力順、path separator、改行形式だけが異なる場合は同一のmanifestになります。意味のあるsource変更は、該当source hashとproject-level hashの両方を変更します。

## Version 1形式

```json
{
  "version": "1",
  "contractVersion": "1",
  "languageVersion": "1.0",
  "platform": "node",
  "entryPath": "src/main.virune",
  "sources": [
    {
      "path": "src/main.virune",
      "sourceSha256": "<lowercase sha256>",
      "utf8ByteLength": 42,
      "lineCount": 3
    }
  ]
}
```

project-level SHA-256はmanifest内へ再帰的に埋め込まず、`KernelSourceManifestResultV1.sha256`としてmanifestと一緒に返します。

## 検証

- `validateKernelSourceManifest`は、未対応version、未知／欠損property、非canonical path、未整列／重複entry、不正なhash、不正なcount、source集合に存在しないentry pathを拒否します。
- `verifyKernelSourceManifest`は、指定されたKernel inputからcanonical manifestを再構築し、すべてのbindingとsource fieldを比較します。期待するproject-level SHA-256も指定できます。

検証はfail-closedです。非canonical dataを暗黙に並べ替えたり修復したりしません。

## 境界

このsliceは、ファイルシステム読取、package resolution、Viruneのparse、type check、JavaScript emit、Production Compilerの変更を行いません。後続のセルフホスティングstageを再現可能にするための実験的data contractです。
