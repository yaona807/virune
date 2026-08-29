# JavaScript相互運用モデル

[英語版](js-interop.md)

低レベルの`extern js`規則は[JavaScript FFI](ffi_ja.md)で定めます。

## `[interop.direct]` 直接利用（Direct Facade）

`import js`では、型宣言されたJavaScript APIのうち保守的に扱える範囲だけを公開します。依存パッケージのソースコードは変換せず、そのまま実行します。直接利用は、デフォルト、名前付き、名前空間、副作用のみ、名前付きの型専用インポート、プロパティ参照、関数・メソッド呼び出し、外部ハンドル（Foreignハンドル）の転送、型宣言上Promise互換（Promise-like）である戻り値への`await`を対象にします。

Providerは、呼び出し先と実引数の型だけからJavaScript呼び出しを解決します。Virune側で期待される戻り値型を、JavaScriptのオーバーロードやジェネリックの選択に使ってはいけません。戻り値にしか現れないジェネリックパラメーターは、TypeScriptのデフォルトまたは基底制約から確定できる場合に限って解決できます。呼び出し先と実引数の型だけから対応している呼び出しを1つに確定できない場合は、アダプターを使わなければなりません。

Virune側の関数を対応しているJavaScriptのコールバック位置へ渡せるのは、後述する生成コールバック境界を経由する場合だけです。Virune関数の生の実行時表現をJavaScriptへ直接渡してはいけません。

CommonJSとして実行されるモジュールからの名前付きインポートは拒否します。ブラウザやバンドラーで実際に使う実行時モジュールの解決は、バンドラーの責任です。

TypeScriptで`any`と宣言されたインポートは、直接利用では拒否します。TypeScriptの`unknown`は型が不明な外部値として保持し、より狭い型を仮定せずにViruneの`Unknown`へ渡せます。

### 生成コールバック境界

生成コールバック境界を使えるのは、固定したProviderがJavaScript呼び出し全体を1つに確定し、その実引数に対応するコールバック型を安全に扱えると証明できた場合だけです。証拠が欠落、古い、不正、曖昧、未解決、`any`、`unknown`、コンストラクター専用、未解決ジェネリック、明示的な`this`付き、任意引数・可変長引数付き、または必須プロパティを持つcallable objectである場合は安全側に失敗し、アダプターを要求しなければなりません。ViruneコンパイラーでTypeScript一般の代入互換性を再実装してはいけません。

最初に対応するのは、名前付きで非ジェネリック、かつ`@jsExport`ではないVirune関数のうち、引数と戻り値が対応プリミティブ型または`Unit`だけで構成され、effect集合が具体的に確定しているものです。`uses *`、Virune側の複合値、`Unknown`へ型消去された値をこの境界から渡してはいけません。TypeScriptの`number`引数だけではViruneの`Int`入力を保証できないため拒否しますが、Viruneの`Int`戻り値はTypeScriptの`number`へ変換できます。

コンパイラーは、バージョン、Virune側の引数・戻り値の種類、非同期かどうか、具体的なeffect、外部からの新規呼び出しとして実行することを含む、Providerに依存しない正規化済みdescriptorを所有します。生成するJavaScript関数は、既存Safe FFIの検証規則で入力を検査し、新しいroot task contextでVirune関数を呼び、既存Safe FFIの変換規則で戻り値をJavaScriptへ変換しなければなりません。また、同期例外と非同期rejectの挙動、およびJavaScriptの実引数評価順序を維持しなければなりません。

TypeScriptの`void`は、Viruneの戻り値を自由に破棄してよいという意味にはなりません。同期の`() => void`へ渡せるのは同期で`Unit`を返すVirune関数だけで、非同期の`Promise<void>`へ渡せるのは非同期で`Unit`を返すVirune関数だけです。

生成したJavaScript関数の同一性は、Virune関数自体の同一性と正規化済み境界descriptorの組で決まります。同じ関数を同じdescriptorで繰り返し変換した場合は同じJavaScript関数オブジェクトを返し、同じ関数でもdescriptorが異なる場合は同じJavaScript関数オブジェクトを共有してはいけません。バージョン付きcacheはVirune関数上の列挙されないコンパイラー内部プロパティとして保持します。この仕組みのために公開project helper、origin export、Runtime ABI entry point、FFI ABI entry pointを追加してはいけません。

安定したprojection evidenceには、生成された`callable-shim`であること、正規化済みdescriptor、Virune側が保証する安全性と未解決の義務、コールバックの実引数index、External Operation列での挿入indexを含めなければなりません。checker内部だけで使うusage indexを安定したcontractへ含めてはいけません。

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
