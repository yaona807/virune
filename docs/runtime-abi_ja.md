# Runtime ABI v2

[English](runtime-abi.md)

Virune 1.0.0はES2022 moduleをRuntime ABI v2向けに出力します。

## Native表現

- Primitiveは検証済みJavaScript primitive表現を使用します。
- Recordはenumerable fieldと非enumerableなnominal `$type` IDを持つnull-prototype objectです。
- Enumは安定したtag付きaggregate値です。
- Newtypeはcompile-timeの名前的同一性を維持し、Runtimeでは検証済み基礎表現へeraseします。
- Type aliasはRuntime同一性を持ちません。
- OptionとResultはRuntime constructorとtagを使用します。
- Native List、Map、SetはViruneコードから不変です。

## 構造的EqとHash

Runtime ABI v2にはprotocol registryがありません。EqとHashは対応する不変値への固定された構造演算です。名前的aggregate IDも比較対象となるため、形が同じでも別宣言の値は同一になりません。Function、resource、Foreign handle、対応外の可変値は構造比較・Hash対象外です。

Compiler生成の`Eq`と`Hash`はこの固定演算を使用し、利用者は意味を差し替えられません。

## Debug

Compiler生成Debugは対応値だけを安定した開発者向け表現へ変換します。明示opt-inであり、TypeScript Bindingへ自動生成しません。

## Cleanup

`defer`は現在のfunction／task scopeへcleanupを登録します。通常return、早期return、`?`伝播、panic、async完了でLIFO実行します。Primary failureとcleanup failureはRuntimeのerror集約契約に従って保持します。

## 構造化並行処理

すべてのtaskはscopeに所属します。`parallel`と`parallel try`はcurrent scopeでchildを開始し、必要に応じてsiblingをcancelし、全childのsettleを待ち、source順による決定的failure選択を維持します。通常のVirune APIはdetached taskを公開しません。

## Interop ABI v2 descriptor

Descriptorは検証済みprimitive、option、result、bytes、対応collection、record、enum、type alias、newtypeを表現します。Record fieldは次を保持できます。

- 外部JavaScript property名
- Optional property欠落用`missingAsNone`
- 出力時property省略用`omitWhenNone`
- 境界で期待するnull／undefined表現
- Compile-time JSON defaultとstrict metadata

Record／Enum descriptorは完全なnominal `typeId`（`package#module:Type`）を持ちます。再帰または未解決descriptorを安全なaggregateとして扱わず、`Unknown`へfallbackするかAdapterを要求します。

Safe descriptorはcallback検証、object keyを持つ任意JavaScript Map／Set、TypeScript `Record<K, V>`変換を保証しません。

## JavaScript export

`@jsExport` wrapperは入力を検証し、出力を変換し、必要なoptional末尾引数を省略し、JavaScriptへ公開するNative aggregateを防御的copyします。Foreign handleを検証済みNative値として扱いません。
