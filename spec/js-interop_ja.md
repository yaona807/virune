# JavaScript相互運用モデル

[英語版](js-interop.md)

低レベルの`extern js`規則は[JavaScript FFI](ffi_ja.md)で定めます。

## `[interop.direct]` 直接利用（Direct Facade）

`import js`では、型宣言されたJavaScript APIのうち保守的に扱える範囲だけを公開します。依存パッケージのソースコードは変換せず、そのまま実行します。直接利用は、デフォルト、名前付き、名前空間、副作用のみ、名前付きの型専用インポート、プロパティ参照、関数・メソッド呼び出し、外部ハンドル（Foreignハンドル）の転送、型宣言上Promise互換（Promise-like）である戻り値への`await`を対象にします。

Providerは、呼び出し先と実引数の型だけからJavaScript呼び出しを解決します。Virune側で期待される戻り値型を、JavaScriptのオーバーロードやジェネリックの選択に使ってはいけません。戻り値にしか現れないジェネリックパラメーターは、TypeScriptのデフォルトまたは基底制約から確定できる場合に限って解決できます。呼び出し先と実引数の型だけから対応している呼び出しを1つに確定できない場合は、アダプターを使わなければなりません。

CommonJSとして実行されるモジュールからの名前付きインポートは拒否します。ブラウザやバンドラーで実際に使う実行時モジュールの解決は、バンドラーの責任です。

TypeScriptで`any`と宣言されたインポートは、直接利用では拒否します。TypeScriptの`unknown`は型が不明な外部値として保持し、より狭い型を仮定せずにViruneの`Unknown`へ渡せます。

## `[interop.foreign-values]` 外部値（Foreign値）

外部値はJavaScript側の値として扱われ、JavaScript上の同一性、プロトタイプ、メソッドのレシーバー、Promiseの挙動、モジュールバインディングの意味を維持します。別の外部呼び出しへそのまま渡すこともできます。Viruneの算術演算、比較、パターンマッチ、コレクションの意味論、Virune側の通常の型（Native型）のメソッドを使うには、事前にNative型へBridgeしなければなりません。

外部値をViruneの公開シグネチャへ含めてはいけません。外部ハンドルはViruneの`newtype`型を通じて公開します。

## `[interop.bridges]` 値の変換（Bridge）

暗黙のBridgeは、実行時表現が一対一に対応するものだけです。

- JavaScript `boolean` → `Bool`
- JavaScript `string` → `String`
- JavaScript `bigint` → `BigInt`
- JavaScript `number` → `Float`
- TypeScript `void` → 戻り値を破棄して`Unit`
- TypeScript `unknown` → Virune `Unknown`

JavaScript `number`から`Int`、配列から`List`、オブジェクトから`record`、`Map` / `Set`の変換、バイト変換、null許容値変換、Virune側の複合値（Native複合値）からJavaScriptへの変換には、明示的なコーデックが必要です。

暗黙のプリミティブ検査に失敗した場合は`ForeignContractError`になります。通常のJavaScript例外を表す結果へは変換しません。回復可能な外部データの検証には、明示的なデコーダーを使用します。

## `[interop.abi-v1]` Interop ABI v1

アダプターは`*.interop.ts`のソースファイルで、固定されたTypeScript Providerによる型検査を行い、Viruneを実行する前にESMとして出力します。

アダプターからのエクスポートは、単一の非ジェネリック呼び出しシグネチャでなければなりません。コールバック引数、オーバーロード、配列、タプル、匿名の構造的オブジェクト、アダプター内部だけで使うオブジェクト型、交差型、`any`、入れ子のPromise互換値はABI v1の値として扱えません。構造データは`unknown`としてエクスポートし、Virune側でデコードします。外部の名前付きクラスやオブジェクトは外部ハンドルとしてエクスポートできます。

アダプターの成果物は`.interop.mjs`、ソースマップ、`.virune-abi.json`です。ABIメタデータは決定的で、スキーマバージョン、ABIバージョン、固定されたTypeScript Providerのバージョン、ソースハッシュ、ABIハッシュ、正規化したエクスポート、ソースパスを含みます。

アダプターからViruneの生成物をインポートしてはいけません。
