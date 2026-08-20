# 互換性・非推奨化ポリシー

[English](compatibility-policy.md) | [日本語](compatibility-policy_ja.md)

この文書は、Viruneの安定版リリースで維持する互換性の約束を定めます。個別のAPI、ABI、診断、リリース、Self-hostingなどの詳細は、それぞれの専用文書で定めます。

## 互換性の分類

Viruneの公開範囲は **Stable**、**Experimental**、**Internal** の3つに分けます。

### Stable

Stableは、安定版の利用者に対して維持する公開契約です。次のうち、文書でStableとして扱っているものが該当します。

- [`../spec/`](../spec/)で定めるVirune言語の規範的な挙動
- `virune.json`の公開済み設定、受け付ける値、その意味と既定値
- 公開標準ライブラリとroot `@virune/compiler` API
- Stableと明示したRuntime ABI／Interop ABI
- 公開CLIのcommand／option／exit codeの意味、diagnostic code、Stableと明示したmachine-readable schema／field
- 公開済みのVirune LSP／VS Code capability、Virune固有setting、public command identifier
- root `engines.node`や宣言済みVS Code API baselineなど、安定版でサポートすると定めたplatform baseline

Stableには、既存利用者の意味を変えない追加や修正を行えます。意図的な非互換変更は、下記の例外を除きmajor releaseで行います。

Version番号、version付きpath、snapshotが存在するだけではStableになりません。Stable化は明示的に行います。API／ABI snapshotは公開範囲を機械的に確認するためのもので、snapshotを更新しただけで非互換変更が許可されたり互換になったりすることはありません。

### Experimental

Experimentalは評価中の公開範囲で、安定版の互換性保証はありません。`@virune/compiler/experimental`など、Experimentalまたはprerelease-onlyと明示したものは任意のreleaseで変更・削除できます。

Semantic Snapshot／Semantic Change Evidence schemaは、明示的にStable化されるまでExperimentalです。評価が完了しただけではStableになりません。利用者への影響が大きい変更はrelease noteで案内します。

Experimentalを利用していても、無関係なStableまでExperimentalになるわけではありません。

### Internal

Internalは公開契約ではありません。Compiler内部構造、Self-hosting内部実装、cache、CI metadata、repository専用command、未文書化のpackage subpathなどが該当します。

Stableな公開契約を維持する限り、Internalは非推奨化を経ずに変更できます。

## Versioningとbreaking change

安定版にはSemantic Versioningを使用します。

- **Patch**（例: `1.0.0` -> `1.0.1`）: 後方互換な修正
- **Minor**（例: `1.0.x` -> `1.1.0`）: 既存のStableな意味を維持する追加・改善
- **Major**（例: `1.x.y` -> `2.0.0`）: Stableへの意図的な非互換変更。影響する利用者向けのmigration guidanceが必要

Prereleaseでは非互換変更があり得て、nightlyには互換性保証がありません。詳細は[`release-channels_ja.md`](release-channels_ja.md)に従います。外部から観測できる挙動を変えない規範仕様の説明修正はbreaking changeではありません。

Stableな公開契約について、たとえば次の変更はbreaking changeです。

- 公開API、ABI、標準ライブラリ、CLI、editor capabilityなどの削除、rename、または文書化済み挙動の非互換変更
- 以前有効だった公開設定や値を拒否すること、またはその意味や既定値を非互換に変更すること
- 以前conformingだったVirune programが規範仕様に従ってparse、type-check、link、evaluateできなくなること、または外部から観測できる意味を非互換に変えること
- Stableなdiagnosticやmachine-readable schemaの意味・構造を非互換に変えること
- Node.jsやVS Codeなどのminimum supported baselineを引き上げ、以前サポートしていた環境を対象外にすること

人間向けの文言、空白、色、layoutなどは、明示的に契約しない限りbyte単位の互換性対象ではありません。また、未文書化のJSON field、設定、editor／protocol detailは、偶然利用できてもStableにはなりません。

## 非推奨化

Stableを意図的に削除または非互換変更する場合は、下記の例外が適用されない限り、次の順序で進めます。

1. 旧surfaceを公開文書でdeprecatedとし、実用的な場合はtoolingやtype metadataにも反映する。
2. replacementまたはmigration方法を示す。
3. 旧surfaceを利用できる状態で、deprecationを含む安定版を少なくとも1回公開する。
4. 削除または非互換変更をmajor releaseで行い、release noteまたはmigration guideへ変更内容と移行方法を記載する。

Migration guidanceは、影響するsurfaceと旧／新contractを示し、適用可能な場合は具体的な移行手順や例を含めます。

ExperimentalとInternalには、このdeprecation期間を要求しません。非推奨化はtype、safety、ABI、validation境界を弱める理由にはならず、deprecatedとしただけで既存programの意味を変えてはいけません。

## Correctness／Safety／Securityの例外

規範仕様、安全境界、security requirementに違反すると分かっている挙動を、互換性だけを理由に維持してはいけません。

後方互換な修正が合理的に可能なら、それを選びます。重大なcorrectness／safety／security defectが残り、合理的な互換修正がない場合に限り、major releaseを待たずに非互換修正を行えます。そのreleaseでは、例外的なcompatibility breakであること、影響するStable surfaceと従来挙動、互換修正を採用できない理由、mitigationまたはmigration方法を明示し、無関係なStable契約を維持します。

既存の規範仕様が要求する挙動へCompilerを戻す修正はcorrectness fixです。その修正がStableと非互換になる場合も、この例外を満たすか次のmajor releaseまで待つ必要があります。誤った実装に依存していたcodeへ移行が必要になる場合は、影響とmigration方法をrelease noteで案内します。

この例外をSemantic Versioningやcompatibility reviewを迂回する一般手段として使ってはいけません。

## 詳細な契約

個別の契約は次を参照してください。

- Language: [`../spec/`](../spec/)
- Compiler API: [`compiler-api_ja.md`](compiler-api_ja.md)
- Runtime／Interop ABI: [`runtime-abi_ja.md`](runtime-abi_ja.md)
- Diagnostic／JSON schema: [`diagnostic-codes_ja.md`](diagnostic-codes_ja.md)
- Release channel: [`release-channels_ja.md`](release-channels_ja.md)
- Self-hosting: [`self-hosting-architecture_ja.md`](self-hosting-architecture_ja.md)、[`self-hosting-seed_ja.md`](self-hosting-seed_ja.md)

Self-hosting recovery artifactの保持や削除は専用のlifecycle policyに従い、Self-host CIが成功しただけではSeedやLegacy rollback pathを削除する理由になりません。

仕様、policy、実装、testの間に不整合がある場合は、より都合のよい解釈を推測せず、該当する契約とtestを整合させてからStableな保証として扱います。Release noteやmigration guideは規範仕様やこのpolicyを暗黙に上書きせず、CIやsnapshotがgreenであることだけを非互換変更の承認として扱ってはいけません。

このpolicyは古いmajor releaseを無期限にサポートすることを約束せず、互換性維持のためにcorrectness、safety、security、ABI、reproducibility、Self-hostingのgateを弱めません。
