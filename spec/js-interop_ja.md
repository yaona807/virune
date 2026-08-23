# JavaScript相互運用モデル

[英語版](js-interop.md)

この文書では、JavaScript相互運用の規範的なアーキテクチャを定めます。低レベルの`extern js`規則は[JavaScript FFI](ffi_ja.md)に記載します。

## Three-Tier

1. **Direct Facade**：`import js`で、型宣言されたJavaScript APIのうち保守的に扱える範囲だけを公開します。依存パッケージのソースコードは変換せず、そのまま実行します。
2. **Compiled Adapter**：複雑なTypeScript APIを`*.interop.ts`へ分離し、固定されたTypeScript Providerで型検査してからESMへ出力します。
3. **Unsafe境界**：利用可能な型宣言がないAPIや、本質的に動的なAPIだけで`unsafe extern js`を使用します。

## Direct Facade

Direct Facadeはdefault / named / namespace / side-effect / named type-onlyの各import、プロパティ参照、関数・メソッド呼び出し、Foreign handleの転送、Promise-likeな戻り値への`await`を対象にします。

JavaScript呼び出しの解決には、呼び出し先（callee）と実引数の型だけを使用します。Virune側で期待される戻り値型を、JavaScriptのオーバーロードやジェネリックの選択に使ってはいけません。戻り値にしか現れないジェネリックパラメーターは、TypeScriptのデフォルトまたは基底制約から確定できる場合にだけ許可します。コールバックの型付け、コンストラクター構文、構造的オブジェクトリテラル、双方向推論、曖昧なオーバーロード、複雑なConditional / Mapped型が必要なAPIではAdapterを使わなければなりません。

CommonJS Runtimeのnamed importは移植性がないため拒否します。default import、namespace import、またはAdapterを使用します。

TypeScriptの`any`はDirect Facadeでは拒否します。TypeScriptの`unknown`はForeign unknownとして保持し、より狭い型を仮定せずにViruneの`Unknown`へ移せます。

## Foreign値

Foreign値はJavaScript上のidentity、prototype、メソッドのreceiver、Promiseの挙動、module bindingの意味を維持します。別のForeign callへそのまま渡すこともできます。Viruneの算術演算、比較、パターンマッチ、コレクションの意味論、Nativeメソッドを使う前に、Native型へBridgeする必要があります。

Foreign型をViruneの公開シグネチャへ含めることはできません。外部handleはViruneの`newtype`型で隠します。

## Bridge

暗黙Bridgeは、実行時表現が一対一に対応するものだけです。

- JavaScript `boolean` → `Bool`
- JavaScript `string` → `String`
- JavaScript `bigint` → `BigInt`
- JavaScript `number` → `Float`
- TypeScript `void` → 戻り値を破棄して`Unit`
- TypeScript `unknown` → Virune `Unknown`

JavaScript `number`から`Int`、Arrayから`List`、objectからrecord、Map / Set、バイト、null許容値、Native複合値からJavaScriptへの変換には、明示的なcodecが必要です。

暗黙のプリミティブ検査に失敗した場合は`ForeignContractError`になります。通常のJavaScript例外を表すResultへ混在させません。回復可能な外部データの不整合は、明示的なデコーダーで処理します。

## Interop ABI v1

Adapterのexportは、単一の非ジェネリック呼び出しシグネチャでなければなりません。コールバック引数、オーバーロード、Array、Tuple、匿名の構造的オブジェクト、Adapter内だけのオブジェクト型、Intersection、`any`、入れ子のPromise-likeはABI v1の値として扱えません。構造データは`unknown`でexportし、Virune側でdecodeします。外部パッケージの名前付きclass / objectはForeign handleとしてexportできます。

Adapterの成果物は`.interop.mjs`、source map、`.virune-abi.json`です。ABI metadataは決定的で、schema version、ABI version、固定されたTypeScript Provider version、source hash、ABI hash、正規化済みexport、source pathを含みます。

AdapterからViruneの生成物をimportしてはいけません。JavaScriptパッケージ → TypeScript Adapter → Viruneモジュールという非循環のbuild順序を維持します。

## ResolutionとStable IR

型宣言の解決とRuntimeモジュールの解決は分けて記録します。WitnessにはRuntime側と宣言側のパッケージidentity、entry、モジュール形式、condition、Provider version、hashを含めます。ブラウザ / bundlerで実際に使うRuntimeの解決はbundlerの責任です。

TypeScriptコンパイラのオブジェクトが有効なのはProviderの解析中だけです。型検査後は、シリアライズ可能でProvider非依存のUsage IRだけを保存します。コード生成は`ts.Type`、`ts.Symbol`、liveなTypeScript `Program`へ依存してはいけません。

## Trust境界

- ViruneのNativeコードはViruneコンパイラが検査します。
- Foreign値の静的な形状はTypeScript宣言から取得します。
- Primitive BridgeはRuntimeで検査します。
- 複合codecは明示的なbudgetと構造上の防御を使って検証し、データをコピーします。
- JavaScript実装の挙動と宣言の正確性は、依存パッケージ側の信頼境界です。
