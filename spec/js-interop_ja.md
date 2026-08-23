# JavaScript相互運用モデル

[英語版](js-interop.md)

この文書では、JavaScript相互運用の規範的なアーキテクチャを定めます。低レベルの`extern js`規則は[JavaScript FFI](ffi_ja.md)に記載します。

## 3段階の相互運用

1. **Direct Facade**：`import js`では、型宣言されたJavaScript APIのうち保守的に扱える範囲だけを公開します。依存パッケージのソースコードは変換せず、そのまま実行します。
2. **Compiled Adapter**：複雑なTypeScript APIを`*.interop.ts`へ分離し、固定されたTypeScript Providerで型検査してからESMへ出力します。
3. **Unsafe境界**：利用可能な型宣言がないAPIや、本質的に動的なAPIに限って`unsafe extern js`を使用します。

## Direct Facade

Direct Facadeは、デフォルト、名前付き、名前空間、副作用のみ、名前付きの型専用インポート、プロパティ参照、関数・メソッド呼び出し、Foreignハンドルの転送、型宣言上Promise-likeである戻り値への`await`を対象にします。

Providerは、呼び出し先と実引数の型だけからJavaScript呼び出しを解決します。Virune側で期待される戻り値型を、JavaScriptのオーバーロードやジェネリックの選択に使ってはいけません。戻り値にしか現れないジェネリックパラメーターは、TypeScriptのデフォルトまたは基底制約から確定できる場合にだけ許可します。コールバックの型付け、コンストラクター構文、構造的オブジェクトリテラル、双方向推論、曖昧なオーバーロード、複雑なConditional / Mapped型が必要な呼び出しでは、Adapterを使わなければなりません。

CommonJS Runtimeの名前付きインポートは移植性がないため拒否します。デフォルトインポート、名前空間インポート、またはAdapterを使用します。

TypeScriptの`any`はDirect Facadeでは拒否します。TypeScriptの`unknown`はForeignのunknown値として保持し、より狭い型を仮定せずにViruneの`Unknown`へ移せます。

## Foreign値

Foreign値は、JavaScript上の同一性、プロトタイプ、メソッドのレシーバー、Promiseの挙動、モジュールバインディングの意味を維持します。別のForeign呼び出しへそのまま渡すこともできます。Viruneの算術演算、比較、パターンマッチ、コレクションの意味論、Nativeメソッドを使う前に、Native型へBridgeする必要があります。

Foreign型をViruneの公開シグネチャへ含めることはできません。外部ハンドルはViruneの`newtype`型で隠します。

## Bridge

暗黙Bridgeは、実行時表現が一対一に対応するものだけです。

- JavaScript `boolean` → `Bool`
- JavaScript `string` → `String`
- JavaScript `bigint` → `BigInt`
- JavaScript `number` → `Float`
- TypeScript `void` → 戻り値を破棄して`Unit`
- TypeScript `unknown` → Virune `Unknown`

JavaScript `number`から`Int`、`Array`から`List`、JavaScriptオブジェクトから`record`、Map / Set変換、バイト変換、null許容値変換、Native複合値からJavaScriptへの変換には、明示的なCodecが必要です。

暗黙のプリミティブ検査に失敗した場合は`ForeignContractError`になります。通常のJavaScript例外を表す`Result`には変換しません。回復可能な外部データの不整合は、明示的なデコーダーで処理します。

## Interop ABI v1

Adapterのexportは、単一の非ジェネリック呼び出しシグネチャでなければなりません。コールバック引数、オーバーロード、配列、タプル、匿名の構造的オブジェクト、Adapter内だけのオブジェクト型、Intersection型、`any`、入れ子のPromise-like値はABI v1の値として扱えません。構造データは`unknown`としてexportし、Virune側でデコードします。外部パッケージの名前付きclass / objectはForeignハンドルとしてexportできます。

Adapterの成果物は`.interop.mjs`、ソースマップ、`.virune-abi.json`です。ABIメタデータは決定的で、スキーマバージョン、ABIバージョン、固定されたTypeScript Providerのバージョン、ソースハッシュ、ABIハッシュ、正規化済みexport、ソースパスを含みます。

AdapterからViruneの生成物をimportしてはいけません。JavaScriptパッケージ → TypeScript Adapter → Viruneモジュールという非循環のビルド順序を維持します。

## 解決とStable IR

型宣言の解決とRuntimeモジュールの解決は別々に記録します。WitnessにはRuntime側と宣言側について、パッケージの同一性、エントリーポイント、モジュール形式、条件、Providerのバージョン、ハッシュを含めます。ブラウザやバンドラーで実際に使うRuntimeの解決は、バンドラーの責任です。

TypeScriptコンパイラのオブジェクトが有効なのはProviderの解析中だけです。型検査後は、シリアライズ可能でProvider非依存のUsage IRだけを保存します。コード生成は`ts.Type`、`ts.Symbol`、TypeScript `Program`オブジェクトへ依存してはいけません。

## 信頼境界

- ViruneのNativeコードはViruneコンパイラが検査します。
- Foreign値の静的な形状はTypeScript宣言から取得します。
- プリミティブBridgeはRuntimeで検査します。
- 複合Codecは明示的に定めた上限と構造上の防御を使って検証し、データをコピーします。
- JavaScript実装の挙動と宣言の正確性は、依存パッケージ側の信頼境界です。
