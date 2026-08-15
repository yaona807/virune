# 互換性・非推奨化ポリシー

[English](compatibility-policy.md) | [日本語](compatibility-policy_ja.md)

この文書は、Viruneのstable releaseに対する互換性契約を定義します。既存のLanguage Specification、version付きRuntime／Interop ABI、公開Compiler API、standard library、CLI、editor integration、Self-hosting recovery artifactを共通ルールで整理し、それぞれの詳細規則を弱めません。

## 互換性クラス

Viruneのsurfaceは **Stable**、**Experimental**、**Internal** の3つへ分類します。

### Stable

Stable surfaceは、stable release利用者に対する互換性の約束です。

- [`../spec/`](../spec/)にある規範的なVirune言語挙動
- 文書化済み`virune.json` project configurationのkey、受理するstable value、その意味、default
- `packages/public-abi.snapshot.json`で追跡する文書化済みpublic standard library surface
- `packages/compiler/api/stable-api.snapshot.json`で追跡するroot `@virune/compiler` APIと、その文書化済みbehavior contract
- stable release向けにStableと明示したRuntime ABI／Interop ABI version
- 文書化済みpublic CLI command／optionとその意味、および文書化済みexit codeの意味
- [`diagnostic-codes_ja.md`](diagnostic-codes_ja.md)で定義したstable diagnostic code／JSON schema contract
- その他、stableと明示して文書化したmachine-readable schemaとfield
- stable release向けに文書化したVirune LSP／VS Code public capability、および文書化済みVirune固有settingのkey、受理するstable value、その意味、default
- identifier自体を文書化したpublic extension command identifier

Stable surfaceはminor releaseで後方互換な追加が可能で、patch releaseで後方互換な修正が可能です。Stable contractを意図的に非互換変更する場合、原則として次のmajor releaseが必要です。

### Experimental

Experimental surfaceは評価のため利用できますが、stable互換性保証の対象外です。任意のreleaseで変更・削除できます。ただし利用者への影響が想定される重要変更はrelease noteで明示することを推奨します。

現在の例:

- `@virune/compiler/experimental`
- Semantic Snapshot／Semantic Change Evidence schema。#213が要求するprototype／corpus評価の後に明示的にstabilizeされない限りExperimentalのままであり、評価完了だけでは自動的にStableにならない
- その他、experimentalまたはprerelease-onlyと明示したAPI／schema

Experimental surfaceを利用していても、無関係なStable surfaceまでExperimentalになるわけではありません。

### Internal

Internal implementation detailはpublic compatibility contractではありません。Compiler内部AST／HIR／MIR、symbol／type arena、lowering phase、Self-hosting内部実装、cache、CI metadata、repository専用command、未文書化package subpath等が該当します。

適用されるStable contractを維持する限り、Internalはdeprecationなしで変更できます。

## Stable releaseのversioning

Viruneのstable releaseは、project-levelのcompatibility signalとしてSemantic Versioningを使用します。

- **Patch**（例: `1.0.0` -> `1.0.1`）: 後方互換な修正。意図的なStable contract変更だけを理由に、既存のconforming programやsupport対象stable consumerへmigrationを要求しません。
- **Minor**（例: `1.0.x` -> `1.1.0`）: 後方互換な追加・改善。既存のconforming programとstable consumerを維持します。
- **Major**（例: `1.x.y` -> `2.0.0`）: Stable contractを意図的に変更できます。影響surfaceには明示的なmigration文書が必要です。

Prerelease／nightlyの互換性は[`release-channels_ja.md`](release-channels_ja.md)を正本とします。Prerelease間では非互換変更があり得て、nightly snapshotには互換性保証がありません。

## Language compatibility

[`../spec/`](../spec/)のファイルを規範的なLanguage contractとします。外部観測可能な挙動を変えないeditorial clarificationはmajor releaseを必要としません。

以前conformingだったprogramが規範contractに従ってparse、type-check、link、evaluateできなくなる場合、またはそのprogramの外部観測可能な意味が非互換に変わる場合、その意図的変更をlanguage breaking changeと扱います。

既存conforming programの意味を維持するsource-compatibleなsyntax／semantics追加はminor releaseで導入できます。

既存の規範仕様が要求している挙動へCompilerを戻す修正は、Language contractの再定義ではなくcorrectness fixです。修正自体がStable surfaceと非互換になる場合は、次のmajor releaseまで待つか、下記のCorrectness／Safety／Security例外修正条件を満たす必要があります。また、誤実装へ依存していたcodeに実質的なmigrationが必要になる場合、release noteで影響挙動を明示しmigration guidanceを提供します。

## Project configuration

文書化済み`virune.json` key、その受理するstable valueと意味、文書化済みdefaultをStableとします。Optional keyや新しいaccepted valueは、既存valid configurationの意味を維持する場合にminor releaseで追加できます。

文書化済みkeyの削除／rename、以前文書上validだったconfigurationの拒否、既存valueの意味変更、同じ既存projectが非互換な挙動を得るような文書化済みdefault変更はbreakingです。未文書化extra keyやimplementation固有parser挙動は、あるCompiler versionで偶然受理されたという理由だけではStableになりません。

## Runtime ABI、Interop ABI、Compiler API、standard library

StableなRuntime／Interop ABI versionはversion付きpathとsnapshotを使用します。ABI固有の詳細規則は[`runtime-abi_ja.md`](runtime-abi_ja.md)を正本とします。新しいABI candidateへversion番号やpathを与えただけではStableにならず、stabilizationは明示的に行う必要があります。すでにStableなABIへのbreaking changeには新しいversion付きABI pathとmigration文書が必要で、snapshotを更新しただけではbreaking changeは互換になりません。

Stableな`@virune/compiler` root entry pointは[`compiler-api_ja.md`](compiler-api_ja.md)に従います。Stable export symbolの削除／rename、signatureの非互換変更、文書化済みbehavior contractの非互換変更はbreakingです。`@virune/compiler/experimental`はこの保証の対象外です。

文書化済みpublic standard library declarationとexport mapはStableです。既存public declaration／package entry pointの削除または非互換変更はbreakingです。既存programの意味を変えないadditive APIはminor releaseで追加できます。

## CLIとmachine-readable output

明示的に別扱いとしない限り、次の文書化済みCLI挙動をStableとします。

- command／option名と、その文書化済みの意味
- 文書化済みexit codeの意味
- [`diagnostic-codes_ja.md`](diagnostic-codes_ja.md)で定義したdiagnostic code、severity、coordinate、JSON schemaの保証
- その他、stableと明示して文書化したmachine-readable schema version／field

文書化済みcommand／optionの削除／rename、または同じ名前を維持したまま文書化済みeffectを非互換に変更することはbreakingです。

人間向けpresentationはbyte-stable interfaceではありません。文書化された意味を維持する限り、文言、空白、色、折返し等のpresentation detailは変更できます。

JSON modeであることだけを理由に全fieldがStableになるわけではありません。JSON field／structureは、ViruneがStable machine-readable schema／fieldとして明示的に文書化した時点でStableになります。未文書化fieldへ依存するconsumerは、それをExperimental／Internal detailとして扱う必要があります。

## LSP／VS Code compatibility

Protocol-level interoperabilityは、宣言済みVS Code API baselineとupstream Language Server Protocolに従います。Stable release向けに文書化したVirune public capabilityは、capabilityの存在と文書化済みcontractの範囲でStableです。Advertise／document済みcapabilityの削除、またはその文書化済みprotocol behaviorの非互換変更はbreakingで、capability追加は原則compatibleです。

文書化済みVirune固有VS Code setting key、その受理するstable valueと意味、文書化済みdefaultはStableです。Settingの削除／rename、以前文書上validだったvalueの拒否、同じconfigurationが非互換な挙動を得るような文書化済みdefault変更はbreakingです。Public extension command identifierは、表示labelだけでなくidentifier自体をpublic interfaceとして文書化した場合にStableとします。

Completion ranking、presentation text、UI layout、内部indexing、cache、scheduling、request implementation、analysis storageは、明示的に別のcontractを定義しない限りcompatibility対象外です。未文書化のVirune固有LSP extension／wire detailは暗黙にStableとは扱いません。以前supportしていたstable environmentを除外する形でminimum VS Code API baselineを引き上げる場合、下記例外がない限りplatform baselineのbreaking changeとして扱います。

## Node.js baseline

Root `engines.node`をstable toolchainのminimum supported Node.js baselineとします。以前supportしていたNode.js environmentがsupport対象外になるようminimumを引き上げることは、意図的なcompatibility breakであり、原則として次のVirune major releaseで行います。

Platform EOL、security requirement等により以前のbaselineを安全または現実的にsupportできなくなった場合は、下記exceptional fix ruleに従い早期変更できます。そのreleaseでは旧／新baselineと変更理由を明記します。

## Deprecation手順

Stable surfaceを意図的に削除または非互換変更する前に、下記exceptional fix ruleが適用される場合を除き、次の順序を必須とします。

1. 該当public documentation、および実用的な場合はtooling／type metadataで旧surfaceをdeprecatedと明示する。
2. Support対象replacementまたはmigration pathを文書化する。
3. 旧surfaceを利用可能なままdeprecationを含むstable releaseを少なくとも1回公開してから、削除するreleaseへ進む。
4. 削除または非互換変更はmajor releaseでのみ行う。
5. Major releaseのrelease noteまたはmigration guideへbreaking changeとmigration手順を記載する。

Deprecation warningだけでprogram semanticsを暗黙変更してはいけません。Deprecationはmigration signalであり、type、safety、ABI、validation境界を弱める許可ではありません。

Experimental／Internal surfaceにはこのdeprecation期間を要求しません。

## Correctness／Safety／Securityの例外修正

規範仕様、安全境界、security requirementに違反すると判明している挙動を維持するためにcompatibilityを優先してはいけません。

後方互換なrepairが合理的に可能ならそれを選択します。Compatibilityを維持すると重大なcorrectness／safety／security defectが残り、合理的なcompatible repairが存在しない場合に限り、次major releaseより前でもexceptional fixを行えます。そのreleaseは次を満たす必要があります。

- exceptional compatibility breakが存在することを明示する
- 影響Stable surfaceと従来挙動を特定する
- compatible alternativeを採用できない理由を説明する
- mitigationまたはmigration guidanceを提供する
- 無関係なStable contractを維持する

この例外をSemantic Versioning／compatibility reviewを迂回する一般手段として使ってはいけません。

## Migration guideの必須条件

Stable surfaceへの意図的breaking changeには、対応するstable release前にmigration guidanceが必要です。影響version／surface、旧contract、新contractを示し、適用可能な場合は具体的なmigration step／exampleを提供します。

関連する複数breaking changeは1つのmigration文書へまとめられます。ただしCIやsnapshotがgreenであることを理由に、影響surfaceを記載対象から外してはいけません。

## Self-hosting Legacy Compiler／fixed Seedの保持

Self-hosting recovery artifactの保持期間は固定日数ではなくlifecycle conditionで決定します。

- Fixed Stage 0 Seedは[`self-hosting-seed_ja.md`](self-hosting-seed_ja.md)の専用Seed更新policyで明示的に置換されるまでimmutable trust rootとして保持する。
- Legacy Compilerは、current Self-hosting promotion／rollback policyが検証済みfallback pathを要求する間は利用可能な状態で保持する。
- Self-host CIが成功しただけではSeed／Legacy rollback pathを削除する承認にならない。
- Seed置換またはLegacy Compiler廃止には独立したreview済みmigration／evidenceを要求し、Language Specification、stable Compiler API、Runtime ABI、Interop ABI、public standard libraryを暗黙変更しない。

## 正本関係

Compatibility判断では次をauthorityとします。

1. **Language semantics**: [`../spec/`](../spec/)を規範とする。解説文書と実装はこれに従う。
2. **Public ABI／API inventory**: commit済みABI／API snapshotはreview対象public surfaceを機械的に特定する。Snapshot更新自体はbreaking changeの承認にならない。
3. **Surface固有documentation**: project configuration、Runtime／Interop ABI、Compiler API、diagnostic／JSON、CLI、LSP／VS Code、release channel、Self-hosting文書が各surfaceの詳細contract／lifecycleを定義する。
4. **Release note／migration guide**: 各releaseで何が変わり、どう移行するかを記述する。規範仕様や本policyを暗黙に上書きしない。
5. **Implementation／test**: conformanceを示しregressionを検出する。Conflictする規範contractを、testがpassするという理由だけで再定義しない。

Authority間に不整合が見つかった場合、より許容的な解釈を推測して採用してはいけません。Stable guaranteeとして扱う前に、該当specification／policyとtestを明示的に整合させます。

## Non-goals

このpolicyは次を行いません。

- Experimental／Internal implementation detailをfreezeする
- 人間向けCLI出力のbyte-for-byte互換性を保証する
- 未文書化JSON field、project configuration key、editor setting、protocol extensionをStable化する
- 古いmajor release lineを無期限supportすると約束する
- compatibility維持のためsecurity、correctness、ABI、reproducibility、Self-hosting promotion gateを弱める
- snapshot／CIがgreenであることを、非互換変更を許可する根拠として扱う

[`release-channels_ja.md`](release-channels_ja.md)、[`compiler-api_ja.md`](compiler-api_ja.md)、[`runtime-abi_ja.md`](runtime-abi_ja.md)、[`diagnostic-codes_ja.md`](diagnostic-codes_ja.md)、規範的な[`../spec/`](../spec/)も参照してください。
