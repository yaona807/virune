# Runtime ABI v2

English: [runtime-abi.md](runtime-abi.md)

Virune 1.0は、ES2022モジュールからRuntime ABI v2を利用します。この文書は、生成コードとRuntimeの間で守る契約を定めます。

## 実行時表現

- primitive値は、検証済みのJavaScript primitive表現を使用します。
- `record`は、列挙可能なfieldと、列挙されないnominal `$type` IDを持つnull-prototype objectです。
- `enum`は、安定したtagを持つaggregate値です。
- `newtype`はコンパイル時の名前的同一性を保ちますが、実行時には検証済みの基礎表現を使用します。
- `type` aliasは実行時の同一性を持ちません。
- `Option`と`Result`はRuntimeのconstructorとtagを使用します。
- Viruneの`List`、`Map`、`Set`はViruneコードから変更できません。

## `Eq`と`Hash`

Runtime ABI v2には、利用者が差し替えられるprotocol registryはありません。

`Eq`と`Hash`は、対応する不変値に対する固定の構造演算です。名前的なaggregate IDも比較に含まれるため、field構成が同じでも別の宣言から作られた値は同一として扱いません。

関数、resource、foreign handle、対応していない可変値は、構造比較やhashの対象外です。

コンパイラーが生成する`Eq`と`Hash`はこの固定演算を使用し、利用者コードから意味を差し替えることはできません。

## `Debug`

コンパイラーが生成する`Debug`は、対応している値だけを安定した開発用表現へ変換します。明示的に指定した場合だけ生成し、TypeScript bindingには自動で追加しません。

## cleanup

`defer`は、現在のfunctionまたはtask scopeへcleanupを登録します。cleanupはLIFO順で実行し、通常return、早期return、`?`による伝播、panic、async処理の完了でも実行します。

処理本体とcleanupの両方で失敗した場合は、Runtimeのerror集約契約に従って両方の情報を保持します。

## 構造化並行処理

すべてのtaskはscopeに所属します。

`parallel`と`parallel try`は現在のscopeでchild taskを開始し、必要に応じてsiblingをcancelし、開始したchildがすべてsettleするまで待ちます。複数の失敗から結果を選ぶ場合は、source順に基づく決定的な選択を維持します。

通常のVirune APIからdetached taskは作成できません。

## Interop ABI v2 descriptor

Descriptorは、検証済みのprimitive、`Option`、`Result`、bytes、対応しているcollection、`record`、`enum`、`type` alias、`newtype`を表現します。

`record` fieldには、必要に応じて次の情報を持たせられます。

- 外部JavaScriptで使うproperty名
- optional propertyの欠落を`None`として扱う`missingAsNone`
- `None`を出力するときproperty自体を省略する`omitWhenNone`
- 境界で期待する`null`／`undefined`の表現
- コンパイル時に確定したJSON defaultとstrictness情報

`record`と`enum`のdescriptorは、`package#module:Type`形式の完全なnominal `typeId`を持ちます。

再帰している型や解決できていない型を、安全なaggregateとして推測してはいけません。完全に検証できない場合は`Unknown`として扱うか、明示的なAdapterを要求します。

Safe descriptorは、callback、objectをkeyに持つ任意のJavaScript `Map`／`Set`、TypeScript `Record<K, V>`を安全に変換できるとはみなしません。

## JavaScript export

`@jsExport`で生成するwrapperは、JavaScriptから受け取る値を検証し、Viruneから返す値を変換します。必要な場合は末尾のoptional引数を省略し、JavaScriptへ渡すnative aggregateは防御的にcopyします。

Foreign handleを、検証済みのVirune native値として扱ってはいけません。

## 公開ABIスナップショット

`packages/public-abi.snapshot.json`は、Runtime v2、Interop v2、Stdlibの公開entry pointについて、package export mapと公開宣言を記録します。また、生成JavaScriptがimportするRuntime v2 symbolも記録します。

互換性は次で確認します。

```bash
npm run abi:check
```

公開symbolの削除、名前変更、非互換なsignature変更、package export mapの非互換変更、Runtime v2の公開範囲外をEmitterが参照する変更はCIで拒否します。

互換性を保った追加であっても、意図した変更であることを確認してからスナップショットを更新します。

```bash
npm run abi:update
```

スナップショットを更新しただけでは、非互換変更を許可したことにはなりません。Runtime ABIを意図的に壊す場合は、新しいversion付きABI pathと移行方法が必要です。判断は[`COMPATIBILITY_ja.md`](../COMPATIBILITY_ja.md)に従います。
