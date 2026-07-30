# Self-hosting Architecture

[English](self-hosting-architecture.md) | [日本語](self-hosting-architecture_ja.md)

- 状態: Accepted
- 対象: Virune CompilerのSelf-hosting
- 親Issue: [#88](https://github.com/yaona807/virune/issues/88)
- Tracking Issue: [#89](https://github.com/yaona807/virune/issues/89)

## 決定

Viruneへ移行するのは、決定的かつdata-orientedなCompiler Kernelだけとします。環境連携、処理の編成、package作成、互換adapterはJavaScript／TypeScript Hostへ残します。

最上位の原則は次のとおりです。

> ViruneをSelf-hostingするためにViruneを変更しない。

Compiler実装を容易にすることだけを理由に、Virune 1.0の言語仕様、公開標準ライブラリ、stable Compiler API、Runtime ABI、Interop ABI、unsafe FFI規則を変更してはいけません。現在の言語と公開Runtimeで自然に表現できない処理は、最初に設計を見直し、次に既存契約内で最適化し、それでも不適切な場合はHostへ残します。

Self-hosting codeは段階的に`main`へmergeできます。ただし、この文書のproduction昇格gateをすべて満たすまで、Production Compiler経路から隔離します。

## 目的

- 純粋なCompiler KernelをViruneで実装する。
- 固定されたStage 0 CompilerでKernelをbuildする。
- Stage 1で同じKernelを再buildし、Stage 1とStage 2を決定的に比較する。
- Self-hosted Kernelと既存TypeScript Compilerを、受理判定、診断、生成module、metadata、runtime動作で比較する。
- Review済みのLegacy Compilerへのrollback経路を維持する。

## 非目標

- Repository内のJavaScript／TypeScriptをすべて削除すること。
- Node.js、ESM、npm、CLI Host、Language Server transport、VS Code Extension Hostを置き換えること。
- Chevrotain、TypeScript Compiler API object、Node.js filesystem objectをViruneへ移植すること。
- Compiler専用の構文、attribute、effect、intrinsic、reflection、unchecked cast、mutable record field、公開標準ライブラリAPIを追加すること。
- 互換性、決定性、性能、rollbackのgateを通過する前にProduction Compilerを切り替えること。

## Architecture

```text
┌──────────────────────────────────────────────────────────┐
│ JavaScript / TypeScript Host                              │
│                                                          │
│ CLI、filesystem、path解決、TypeScript API、              │
│ JavaScript binding解析、VS Code、LSP transport、         │
│ packaging、release自動化、bootstrap orchestration        │
└────────────────────────────┬─────────────────────────────┘
                             │ versionedかつ検証済みのdataのみ
                             ▼
┌──────────────────────────────────────────────────────────┐
│ Virune Compiler Kernel                                   │
│                                                          │
│ Token model、Lexer、Parser、AST、diagnostic、symbol、    │
│ type、effect check、HIR、module semantic、Emitter        │
└────────────────────────────┬─────────────────────────────┘
                             │ 決定的なKernelOutput
                             ▼
                    読みやすいES2022 module
```

Hostはeffectと環境依存処理を担当します。Kernelは純粋処理、またはstateを明示的に受け渡す言語意味論を担当します。

## Hostの責務

JavaScript／TypeScript Hostには次を残します。

- CLI entry pointとprocess lifecycle。
- Filesystem access、canonical path解決、environment variable、暗号学的hash。
- Project sourceの探索とsource textの読み込み。
- TypeScript declaration解析とJavaScript binding解析。
- Interop Manifestの構築と検証。
- Platform libraryが必要なSource Mapの最終encoding。
- Language Server transportとVS Code Extension Host連携。
- Package組み立て、release公開、attestation、GitHub Actions補助処理。
- Stage 0取得、Seed検証、Stage 1／Stage 2 orchestration、rollback選択。

これらはversioned adapterを介してKernelを呼び出せますが、環境objectをcontractへ露出してはいけません。

## Kernelの責務

Virune Compiler Kernelには次を実装できます。

- Source position、span、token kind、token、documentation comment metadata。
- Lexerとhand-written Parser。
- AST、symbol、type、effect、diagnostic model。
- Name resolution、visibility、control-flow validation、type check、effect check。
- HIRまたは同等の明示的なlowering model。
- 決定的なJavaScript module emission。
- 収集済みのcanonical sourceを入力とするmodule graphとpublic API validation。
- 検証済みdata-only Interop Manifestの処理。
- Differential比較とbootstrap比較で使用するcanonical serialization。

Kernelはidentity-sensitiveなobject graphではなく、immutable value、arena ID、canonical table、sorted collection、明示的state passingを使用します。

## Host–Kernel Contract

境界はversioned、machine-readable、JSON相当dataとしてserialize可能であり、入出力の両方向で検証しなければなりません。

### 許可する入力

`KernelInput`には次を含められます。

- Contract versionと言語version。
- Target platform。
- Canonical entry path。
- Canonical順に並べたsource pathとsource textの組。
- Versionedかつ検証済みのInterop Manifest。
- Plain dataで表現したemit optionとdiagnostic option。

### 許可する出力

`KernelOutput`には次を含められます。

- Stable code、severity、range、related information、help、structured fixを持つdiagnostic。
- Emitted JavaScript moduleとSource Map segment。
- Exported symbolとpublic API metadata。
- Module dependencyとcanonical module order。
- 決定的なdataとして表現したcompilation statistics。

### 境界で禁止する値

Contractでは次を拒否、または使用しません。

- Callbackと任意のJavaScript function。
- Class instanceとprototype依存value。
- TypeScript AST nodeとCompiler API object。
- Chevrotain CST nodeとParser object。
- Node.js `Error` object、filesystem handle、stream、identityを持つobjectとしてのbuffer、process object。
- VS Code、LSP transport、editor host object。
- Insertion orderまたはobject identityで意味が変わるMap、Set、object graph。

## 保護対象

Self-hosting実装を容易にするために、次を変更してはいけません。

- `spec/`配下の規範意味論。
- Grammar、keyword、precedence、token規則。
- 公開標準ライブラリAPI。
- Runtime ABI v2。
- Interop ABI v2。
- Stable Compiler APIのresponseと互換性方針。
- Safe／unsafe FFI境界。
- 既存conformanceの受理・拒否動作。

一般利用者にも独立して必要な言語提案だけが、別Issue・別Pull Requestで保護対象を変更できます。その提案には仕様、互換性、conformance、documentation、migrationの分析が必要です。

## ParserとState model

Self-hosted ParserはChevrotainの機械的移植ではなく、新しい実装とします。

- Declaration、statement、type formにはRecursive Descentを使用する。
- ExpressionにはPratt Parserまたはprecedence climbingを使用する。
- CSTを公開せずASTを直接構築する。
- Review済みのsynchronization token setでsyntax errorからrecoverする。
- Token metadataを介してdocumentation commentを関連付ける。

Compiler stateでは次を優先します。

- Immutableなrecordとenum。
- 明示的なstate transition。
- Node、symbol、typeのarena ID。
- Canonical tableと決定的serialization。
- Hash tableまたはinsertion behaviourに依存しないstable ordering。

性能問題は、最初にalgorithm、persistent structure、Runtime内部最適化、Hostへの残置で解決します。保護対象の緩和は認めません。

## 統合とCommand隔離

Self-hosting commandには`selfhost:*` namespaceを使用します。既存の`bootstrap` commandと通常の利用者向けCompiler commandから分離します。

例:

- `selfhost:seed:verify`
- `selfhost:mvp:check`
- `selfhost:mvp:test`
- `selfhost:differential`
- `selfhost:bootstrap`

Production昇格までは、`virune check`、`virune build`、`virune run`、stable Compiler APIなどの通常経路はLegacy Compilerを既定で使用します。

未完成のSelf-hosting componentは、次を満たす場合に`main`へmergeできます。

- Production経路を変更しない。
- 既存quality gateを維持し、すべて成功する。
- Internal moduleまたは`selfhost:*` commandからだけ利用できる。
- Public API／ABIへ未完成のSelf-hosting型を露出しない。
- 追加動作が決定的であり、対象を絞ったtestがある。

## 停止・切り出し条件

次のいずれかが発生した場合、Self-hosting Issue内の実装を停止し、保護対象を変更してはいけません。

- 新しい構文、keyword、built-in effect、Compiler intrinsic、reflection、unchecked cast、mutable record field、class継承、macro、operator overloadが必要に見える。
- Self-hosting専用の公開標準ライブラリAPIが必要になる。
- Host–Kernel Contractをdata-onlyに維持できない。
- Correctnessがobject identity、hash iteration order、ambient filesystem state、未文書化のRuntime動作へ依存する。
- 互換差分をexpectedな一時差分として説明・reviewできない。
- 言語または安全性保証を弱めなければ決定性、memory、performance budgetを満たせない。

対応順序は次のとおりです。

1. 既存の`record`、`enum`、`fn`、`Result`、`Option`、immutable collection、arena ID、明示的state passingで再設計する。
2. Public contractを変更せず、algorithmまたはRuntime内部実装を改善する。
3. 対象処理をTypeScript Hostへ残す。
4. 通常のVirune programにも独立して価値がある場合だけ、別の言語提案Issueを作成する。

Self-hosting Pull Requestへ、その言語提案を含めてはいけません。

## 段階的導入

1. **Architecture** — このADRと保護対象規則を確定する。
2. **Contract** — `KernelInput`、`KernelOutput`、validation、Legacy adapterを定義する。
3. **Seed** — Stage 0 Compiler artifactとmetadataを固定・検証する。
4. **Differential harness** — 同じcontractを通して2実装を比較する。
5. **Vertical MVP** — 小さく限定した言語subsetをVirune sourceからES2022までcompileする。
6. **Frontend互換** — Virune 1.0のLexer／Parserを完全実装する。
7. **Semantic互換** — Type、effect、control flow、concurrency、FFI validationを実装する。
8. **Project互換** — Multi-module semanticとInterop Manifest処理を実装する。
9. **Non-blocking Shadow** — 通常のPull Requestをblockせず比較jobを実行する。
10. **Required Shadow** — 最初にSelf-host変更、次に関連Compiler変更へSelf-host checkをrequired化する。
11. **Internal opt-in** — Compiler facadeから明示的に選択可能にする。
12. **Production default** — すべての昇格gate通過後だけ既定実装を切り替える。
13. **Legacy整理** — 保持期間とrollback要件を満たした後だけ削除を検討する。

## Production昇格gate

次のすべてを同一candidate commitで実証するまで、Self-hosted Compilerを既定にしてはいけません。

- Full conformanceのaccepted／rejected結果がLegacy Compilerと一致する。
- Diagnostic code、severity、range、related information、help、structured fixに未説明差分がない。
- Public Compiler API responseが互換である。
- Runtime ABI v2とInterop ABI v2が互換である。
- Node.js／browser integrationが成功する。
- Fuzz regression、semantic fuzz、binding corpusが成功する。
- Stage 0がStage 1をbuildし、Stage 1が同じsourceをStage 2として再buildする。
- 正規化したStage 1／Stage 2のJavaScript、Source Map、module order、exports、diagnostic schema、metadata、checksumが一致する。
- Clean cloneとoffline bootstrapが成功する。
- Cold buildとincremental buildの中央値がLegacy Compilerの1.25倍以内である。
- Peak resident memoryが1.5倍以内、artifact sizeが1.25倍以内である。
- 集計結果によって重大な個別fixture regressionを隠していない。
- Legacy fallbackとrelease repair rollback smokeが成功する。
- 英語・日本語の運用documentationが同期している。

Gate失敗時は昇格を延期します。既存のquality、security、compatibility、reproducibility、release checkを弱めてはいけません。

## Legacy保持とRollback

Compiler facadeは導入期間中、Legacy実装とSelf-hosted実装を明示的に選択できる状態を維持します。

Production default切り替え後:

- Legacy Compilerを少なくとも1回の完全なstable release cycleで保持する。
- Self-hosted defaultを含むstable releaseを公開・検証する。
- 次のrelease candidateを、直前のSelf-hosted stable releaseから生成する。
- 保持期間中に重大な未説明互換差分を残さない。
- 固定したStage 0 Seed、checksum、verification metadataを利用可能な状態で保持する。
- Clean cloneからCompilerをbootstrapできる。
- Release repair、Seed復元、Legacy fallbackを検証する。

Rollbackで変更するのはCompiler選択だけです。言語仕様、公開API、ABI、利用者source、公開済みSeed bytesの変更を要求してはいけません。

Legacy Compiler Coreは、すべての保持要件を満たした後、別途reviewするPull Requestでだけ削除できます。CLI Host、JavaScript／TypeScript interoperability provider、VS Code Host、LSP transport、packaging、release automation、bootstrap orchestrationはLegacy Core削除の対象外です。

## 検証

Documentation変更では次を成功させます。

```bash
npm run docs:check
```

実装Pull Requestでは、対象を絞ったSelf-hosting checkと、Repository policyが選択する既存checkをすべて実行します。Self-hosting Pull Requestで既存CI、security、compatibility、reproducibility、release gateを削除、迂回、弱体化してはいけません。
