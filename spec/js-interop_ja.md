# JavaScript相互運用モデル

[English](js-interop.md) | [日本語](js-interop_ja.md)

本書はJavaScript相互運用architectureの規範仕様です。低levelの`extern js`規則は[`ffi_ja.md`](ffi_ja.md)に記載します。

## Three-Tier

1. **Direct Facade**：`import js`で型宣言済みJavaScript APIの保守的subsetを公開し、依存sourceは変換せず実行します。
2. **Compiled Adapter**：複雑なTypeScript APIを`*.interop.ts`へ隔離し、固定TypeScript Providerで型検査してからESMへ出力します。
3. **Unsafe境界**：利用可能な型宣言がないAPIや本質的に動的なAPIだけ`unsafe extern js`を使用します。

## Direct Facade

Direct Facadeはdefault／named／namespace／side-effect／named type-only import、property参照、function・method呼び出し、Foreign handleの転送、Promise-like戻り値への`await`を対象にします。

JavaScript callの解決にはcalleeと実引数型だけを使用します。Virune側の期待戻り値型をJavaScript overload・generic選択へ参加させてはいけません。戻り値だけに現れるgeneric parameterはTypeScriptのdefaultまたはbase constraintから確定できる場合のみ許可します。callback typing、constructor構文、構造object literal、双方向推論、曖昧なoverload、複雑なConditional／Mapped型が必要なAPIはAdapter対象です。

CommonJS Runtimeのnamed importはportableではないため拒否します。default／namespace importまたはAdapterを使用します。

TypeScript `any` importはDirect Facadeで拒否します。TypeScript `unknown`はForeign unknownとして保持し、より狭い型を仮定せずVirune `Unknown`へ移せます。

## Foreign値

Foreign値はJavaScriptのidentity、prototype、method receiver、Promise挙動、module binding semanticsを維持します。別のForeign callへそのまま渡せます。Viruneの算術、比較、pattern match、collection semantics、Native methodを使う前にNative型へBridgeする必要があります。

Foreign型をViruneのpublic signatureへ公開できません。外部handleはVirune `newtype`型で隠します。

## Bridge

暗黙Bridgeは実行時表現が一対一のものだけです。

- JavaScript `boolean` → `Bool`
- JavaScript `string` → `String`
- JavaScript `bigint` → `BigInt`
- JavaScript `number` → `Float`
- TypeScript `void` → 戻り値を破棄して`Unit`
- TypeScript `unknown` → Virune `Unknown`

JavaScript `number`から`Int`、Arrayから`List`、objectからrecord、Map／Set、byte、nullable、Native複合値からJavaScriptへの変換は明示codecを要求します。

暗黙primitive検査の失敗は`ForeignContractError`です。通常のJavaScript例外Resultへ混在させません。回復可能な外部data不整合は明示decoderで処理します。

## Interop ABI v1

Adapter exportは単一の非generic call signatureでなければなりません。callback parameter、overload、Array、Tuple、匿名構造object、Adapter内だけのobject型、Intersection、`any`、nested Promise-likeをABI v1値にできません。構造dataは`unknown`でexportし、Virune側でdecodeします。外部packageの名前付きclass／objectはForeign handleとしてexportできます。

Adapter成果物は`.interop.mjs`、source map、`.virune-abi.json`です。ABI metadataはdeterministicで、schema version、ABI version、固定TypeScript Provider version、source hash、ABI hash、正規化済みexport、source pathを含みます。

AdapterからVirune生成物をimportしてはいけません。JavaScript package → TypeScript Adapter → Virune moduleという非循環build順序を維持します。

## ResolutionとStable IR

型宣言解決とRuntime module解決を分離して記録します。WitnessにはRuntime／宣言package identity、entry、module形式、condition、Provider version、hashを含めます。browser／bundlerの実Runtime解決はbundlerの責任です。

TypeScript compiler objectはProvider解析中だけ有効です。型検査後はserialize可能でProvider非依存のUsage IRだけを保存します。Codegenは`ts.Type`、`ts.Symbol`、live TypeScript `Program`へ依存してはいけません。

## Trust境界

- Virune Native codeはVirune compilerが検査します。
- Foreignの静的形状はTypeScript宣言から取得します。
- Primitive BridgeはRuntime検査を行います。
- Composite codecは明示budgetと構造防御を用いて検証・copyします。
- JavaScript実装の挙動と宣言の正確性は依存packageのtrust boundaryです。
