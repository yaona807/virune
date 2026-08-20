# セルフホスト昇格対象の識別子

[English](self-hosting-promotion-subject.md)

Viruneの昇格証拠では、**どのcommitで検証したか**と**どの製品を観測しているか**を分離します。

- 実行commitはGit上の出所です。Pull Requestの証拠は引き続きexact head commitへ厳密に結び付けます。
- 昇格対象は製品の識別子です。stageごとの製品closureが同一である限り、repository commitが変わっても長期観測履歴を継続できます。

これにより、ドキュメントやガバナンスだけの変更で不変のCompiler観測がリセットされる問題を避けつつ、exact-headの監査可能性を維持します。

## Version 2 manifest

`PromotionSubjectManifest` version 2は、昇格stageと、そのstageで必要なSHA-256識別子だけを保持します。Git commitは意図的に含めません。componentはversioned stage contractの順序へ正規化し、canonical JSONとして直列化したうえでSHA-256を計算します。この値が`promotionSubjectId`です。

すべてのdigestは小文字64文字のSHA-256でなければなりません。必須componentの欠落、重複、余分なcomponent、不正なdigest、未知のcomponentはfail closedで拒否します。component taxonomyは変更pathから推測せず、versioned contractとして固定します。

## Stageごとのclosure

| Stage | 製品closure |
| --- | --- |
| `required-selfhost` | bootstrap policy、fixed Seed、Stage 3 Compiler artifact、Self-host Host contract、Runtime artifact/ABI、Standard Library artifact |
| `required-compiler` | 上記に加えてCompiler Host、JavaScript/TypeScript Interop、Compiler API、Interop ABI、dependency closure |
| `production-default` | 上記に加えてreview済みrelease artifactとrelease reproducibility identity |

後続stageは前段stageの製品closureを必ず包含します。またstage名そのものをcanonical manifestへ含めるため、共通componentのdigestが同じでもstage間のidentityは分離されます。

## 境界

このcontractは、昇格threshold、観測履歴の評価、Nightly／Required Shadow workflow、昇格承認、Production compiler切り替え、Shadow History version 1の廃止を変更しません。これらは後続sliceで扱います。

Promotion policyも製品componentには含めません。policyが変わった場合は、不変の製品identityを変えるのではなく、保存済みrunを現在のrequired evidenceに対して再評価します。
