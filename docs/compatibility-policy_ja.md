# 互換性・非推奨化ポリシー

[English](compatibility-policy.md) | [日本語](compatibility-policy_ja.md)

この文書は、Viruneの安定版リリースで守る互換性の約束を定めます。個別のAPI、ABI、診断、リリース、Self-hostingなどの詳細は、それぞれの専用文書で定めます。

## 互換性の分類

Viruneでは、互換性の対象を **Stable**、**Experimental**、**Internal** の3つに分けます。

### Stable

Stableは、安定版の利用者に対して維持する公開契約です。次をStableとして扱います。

- [`../spec/`](../spec/)で定めるVirune言語の規範的な挙動
- 文書化済みの`virune.json`設定、安定版で受け付ける値、その意味と既定値
- 文書化済みの標準ライブラリ公開宣言とexport map、およびroot `@virune/compiler` APIの公開symbolと文書化済み挙動
- Stableと明示したRuntime ABI／Interop ABI
- 文書化済みの公開CLI command／optionとその意味、およびexit codeの意味
- [`diagnostic-codes_ja.md`](diagnostic-codes_ja.md)で定めるdiagnostic code／JSON schemaの契約と、その他Stableと明示した機械可読なschema／field
- 安定版向けに文書化したVirune LSP／VS Codeの公開機能、Virune固有設定のkey・受け付ける値・意味・既定値、identifier自体を公開interfaceとして文書化したextension command
- root `engines.node`や宣言済みVS Code API versionなど、安定版でサポートすると定めた最低version

LSPのprotocol-level interoperabilityは、宣言済みVS Code API baselineとupstream Language Server Protocolに従います。

Stableには、既存利用者の意味を変えない追加や修正を行えます。意図的な非互換変更は、下記の例外を除きmajor releaseで行います。

バージョン番号、バージョン付きpath、snapshotが存在するだけではStableになりません。Stable化は明示的に行います。API／ABI snapshotは公開範囲を機械的に確認するためのもので、snapshotを更新しただけで非互換変更が許可されたり互換になったりすることはありません。

### Experimental

Experimentalは評価中の公開範囲で、安定版の互換性保証はありません。`@virune/compiler/experimental`など、Experimentalまたはprerelease-onlyと明示したものは任意のreleaseで変更・削除できます。

Semantic Snapshot／Semantic Change Evidence schemaは、#213で要求するprototype／corpus評価を終えた後に明示的にStable化されるまでExperimentalです。評価が完了しただけではStableになりません。利用者への影響が想定される重要変更は、リリースノートで明示することを推奨します。

Experimentalを利用していても、無関係なStableまでExperimentalになるわけではありません。

### Internal

Internalは公開契約ではありません。Compiler内部構造、Self-hostingの内部実装、cache、CI metadata、repository専用command、未文書化のpackage subpathなどが該当します。

Stableな公開契約を維持する限り、Internalは非推奨化を経ずに変更できます。

## バージョンと非互換変更

安定版のversioningにはSemantic Versioningを使用します。

- **Patch**（例: `1.0.0` -> `1.0.1`）: 後方互換な修正
- **Minor**（例: `1.0.x` -> `1.1.0`）: 既存のStableな意味を維持する追加・改善
- **Major**（例: `1.x.y` -> `2.0.0`）: Stableへの意図的な非互換変更。影響する利用者向けの移行方法が必要

Prereleaseでは非互換変更があり得て、nightlyには互換性保証がありません。詳細は[`release-channels_ja.md`](release-channels_ja.md)に従います。外部から観測できる挙動を変えない規範仕様の説明修正は、非互換変更ではありません。

Stableな公開契約について、たとえば次の変更は非互換です。

- 公開API、ABI、標準ライブラリ、CLI、エディタ機能などの削除、rename、signature変更、または文書化済み挙動の非互換変更
- 以前有効だった公開設定や値を拒否すること、またはその意味や既定値を非互換に変更すること
- 以前仕様に適合していたVirune programが、規範仕様に従ってparse、type-check、link、evaluateできなくなること、または外部から観測できる意味を非互換に変えること
- Stableなdiagnosticや機械可読schemaの意味・構造を非互換に変えること
- Node.jsやVS Codeなどの最低対応versionを引き上げ、以前サポートしていた環境を対象外にすること

PlatformのEOL、セキュリティ要件などにより従来のversionを安全または現実的にサポートできなくなった場合は、下記の例外条件に従ってmajor releaseより前に変更できます。その場合は変更前後のversionと理由を明示します。

人間向けの文言、空白、色、layoutなどは、明示的に契約しない限りbyte単位の互換性対象ではありません。また、未文書化のJSON field、設定、エディタやprotocolの仕様は、偶然利用できてもStableにはなりません。

補完候補の順位、UI layout、内部indexing、cache、scheduling、request処理、analysis dataの保存方法も、明示的に別の契約を定めない限りStableではありません。

## 非推奨化

Stableを意図的に削除または非互換変更する場合は、下記の例外が適用されない限り、次の順序で進めます。

1. 旧対象が非推奨であることを公開文書に明記し、実用的な場合はtoolingや型metadataにも反映する。
2. サポート対象の代替手段または移行方法を示す。
3. 旧対象を利用できる状態で、非推奨化を含む安定版を少なくとも1回公開する。
4. 削除または非互換変更をmajor releaseで行い、リリースノートまたはmigration guideへ変更内容と移行方法を記載する。

移行方法は対応する安定版の公開前に用意し、対象version・対象範囲と変更前後の契約を示します。適用可能な場合は、具体的な移行手順や例も含めます。

ExperimentalとInternalには、この非推奨期間を要求しません。非推奨化はtype、safety、ABI、validation境界を弱める理由にはならず、非推奨としただけで既存programの意味を変えてはいけません。

## 正しさ・安全性・セキュリティ上の例外

規範仕様、安全境界、セキュリティ要件に違反していると分かっている挙動を、互換性だけを理由に維持してはいけません。

後方互換な修正が合理的に可能なら、それを選びます。重大な正しさ・安全性・セキュリティ上の欠陥が残る場合、またはplatformのEOLなどで従来のversionを安全・現実的にサポートできない場合で、合理的な互換修正がないときに限り、major releaseを待たずに非互換修正を行えます。

そのリリースでは、例外的な非互換変更であること、影響するStable対象と従来の挙動、互換修正を採用できない理由、緩和策または移行方法を明示し、無関係なStable契約を維持します。

既存の規範仕様が要求する挙動へCompilerを戻す修正は、言語契約の変更ではなく正しさを回復する修正です。その修正がStableと非互換になる場合も、この例外を満たすか次のmajor releaseまで待つ必要があります。誤った実装に依存していたcodeへ移行が必要になる場合は、影響と移行方法をリリースノートで案内します。

この例外をSemantic Versioningや互換性reviewを迂回する一般手段として使ってはいけません。

## 詳細規則の参照先

個別の契約は次を参照してください。

- Language: [`../spec/`](../spec/)
- Compiler API: [`compiler-api_ja.md`](compiler-api_ja.md)
- Runtime／Interop ABI: [`runtime-abi_ja.md`](runtime-abi_ja.md)
- Diagnostic／JSON schema: [`diagnostic-codes_ja.md`](diagnostic-codes_ja.md)
- Release channel: [`release-channels_ja.md`](release-channels_ja.md)
- Self-hosting: [`self-hosting-architecture_ja.md`](self-hosting-architecture_ja.md)、[`self-hosting-seed_ja.md`](self-hosting-seed_ja.md)

Self-hostingの復旧用artifactの保持や削除は専用のlifecycle policyに従い、Self-host CIが成功しただけではSeedやLegacy rollback pathを削除する理由になりません。

仕様、policy、実装、testの間に不整合がある場合は、より都合のよい解釈を推測せず、該当する契約とtestを整合させてからStableな保証として扱います。リリースノートやmigration guideは規範仕様やこのpolicyを暗黙に上書きせず、CIやsnapshotがgreenであることだけを非互換変更の承認として扱ってはいけません。

このpolicyは古いmajor releaseを無期限にサポートすることを約束せず、互換性維持のために正しさ、安全性、セキュリティ、ABI、reproducibility、Self-hostingのgateを弱めません。
