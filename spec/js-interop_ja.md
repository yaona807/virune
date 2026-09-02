# JavaScript相互運用モデル

[英語版](js-interop.md)

低レベルの`extern js`規則は[JavaScript FFI](ffi_ja.md)で定めます。

## `[interop.direct]` 直接利用（Direct Facade）

`import js`では、型宣言されたJavaScript APIのうち保守的に扱える範囲だけを公開します。依存パッケージのソースコードは変換せず、そのまま実行します。直接利用は、デフォルト、名前付き、名前空間、副作用のみ、名前付きの型専用インポート、プロパティ参照、関数・メソッド呼び出し、外部ハンドル（Foreignハンドル）の転送、型宣言上Promise互換（Promise-like）である戻り値への`await`を対象にします。

Providerは、呼び出し先と実引数の型だけからJavaScript呼び出しを解決します。Virune側で期待される戻り値型を、JavaScriptのオーバーロードやジェネリックの選択に使ってはいけません。戻り値にしか現れないジェネリックパラメーターは、TypeScriptのデフォルトまたは基底制約から確定できる場合に限って解決できます。呼び出し先と実引数の型だけから対応している呼び出しを1つに確定できない場合は、アダプターを使わなければなりません。

Virune側の関数を対応しているJavaScriptのコールバック位置へ渡せるのは、後述する生成コールバック境界を経由する場合だけです。Virune関数の生の実行時表現をJavaScriptへ直接渡してはいけません。

CommonJSとして実行されるモジュールからの名前付きインポートは拒否します。ブラウザやバンドラーで実際に使う実行時モジュールの解決は、バンドラーの責任です。

ソース検査では、build段階の`runtime-resolution`義務が未解決のまま残ることがあります。診断エラーのない`check`結果だけでは、実行を許可したことにはなりません。`virune run`または`virune test`が生成JavaScriptを開始する前に、実際に実行されるモジュールclosure内のすべての実行時module loadについて、そのexact buildに結び付いたProvider非依存のruntime-resolution evidenceがdischargedでなければなりません。pending、unresolved、欠落、不正、矛盾した証拠は安全側に失敗し、Nodeを開始してはいけません。

TypeScriptで`any`と宣言されたインポートは、直接利用では拒否します。TypeScriptの`unknown`は型が不明な外部値として保持し、より狭い型を仮定せずにViruneの`Unknown`へ渡せます。

### 文脈付きExternal操作

文脈付き集約リテラル`{ field: value }`を通常のJavaScriptデータオブジェクトとして扱えるのは、固定されたProviderが、期待されるExternal構造型に対してオブジェクト利用全体を証明できた場合だけです。期待型は、実行時インポートを追加せず、JavaScriptの名前付き型専用インポートから得ることもできます。入れ子の文脈付き集約と、対応しているVirune関数のプロパティも同じTypeScript利用全体の中で検査します。プロパティの欠落・余分なプロパティ・型不一致・古い証拠・部分的な証拠・不正な証拠・`any`・`unknown`はすべて安全側に失敗しなければなりません。Viruneの`record`、`List`、タプル、その他の複合値を暗黙にJavaScriptオブジェクトへ変換してはいけません。

文脈付きオブジェクトの各プロパティは、左から右へ1回だけ評価します。プロパティ名は計算済みデータプロパティとして出力するため、`__proto__`のような名前もオブジェクトのプロトタイプを変更せず、通常のown data propertyとして扱います。Virune関数をプロパティへ入れる場合は後述する生成コールバック境界を使い、Virune関数の生の実行時表現をJavaScriptオブジェクトへ漏らしてはいけません。

`value[index]`を利用できるのは、実際のレシーバーとindex値に対する添字アクセスをTypeScriptが証明できた場合だけです。レシーバーとindexはJavaScriptの順序でそれぞれ1回だけ評価し、結果は許可されたBridgeを適用するまでは外部値として保持します。対応していないindex種別、未解決のアクセス、`any`または`unknown`の証拠は安全側に失敗しなければなりません。

External値のプロパティ代入とindex代入を利用できるのは、宣言された対象への対応する代入をTypeScriptが受理した場合だけです。`readonly`など、書き込みできない対象は安全側に失敗しなければなりません。生成コードは通常のJavaScript参照意味論と評価順序を維持します。プロパティ代入ではレシーバーの後に値、index代入ではレシーバー、index、値の順に評価します。そのためsetter、Proxy trap、同期例外もJavaScript本来の挙動を維持します。

通常の呼び出し構文をコンストラクター呼び出しとして出力できるのは、通常のcall解決が成立せず、Providerが呼び出し先と実引数からconstruct利用を証明できた場合だけです。callableかつconstructableな値は曖昧であり、コンストラクターだと推測してはいけません。privateなどアクセスできないconstructor、戻り値を確定できないジェネリック、不正または古い証拠、対応していないconstructor選択は安全側に失敗しなければなりません。対応範囲内のオーバーロードおよびジェネリックconstructorの選択は、実引数だけを使ってTypeScriptへ委ねます。生成コードはJavaScriptのconstruction semantics、実引数の評価順序、constructorからの例外を維持します。

文脈付きオブジェクト、index、write、constructの成功判定は、Providerに依存しないExternal Operation evidenceとして表現しなければなりません。Providerのhandleやgenerationはchecker内部の証明入力であり、安定したoperation出力へ含めてはいけません。コンパイラーは出力を有効にする前に、証拠がcurrentで完全かつ構造的に正規化され、対応するusageへ結び付いていることを検証しなければなりません。TypeScript一般の代入互換性をVirune側で再実装してはいけません。

### 生成コールバック境界

生成コールバック境界を使えるのは、固定したProviderがJavaScript呼び出し全体を1つに確定し、その実引数に対応するコールバック型を安全に扱えると証明できた場合だけです。証拠が欠落、古い、不正、曖昧、未解決、`any`、`unknown`、コンストラクター専用、未解決ジェネリック、明示的な`this`付き、任意引数・可変長引数付き、または必須プロパティを持つcallable objectである場合は安全側に失敗し、アダプターを要求しなければなりません。ViruneコンパイラーでTypeScript一般の代入互換性を再実装してはいけません。

プリミティブcallableとして対応するのは、名前付きで非ジェネリック、かつ`@jsExport`ではないVirune関数のうち、引数と戻り値が対応プリミティブ型または`Unit`だけで構成され、effect集合が具体的に確定しているものです。`uses *`、Virune側の複合値、`Unknown`へ型消去された値をこのプリミティブ境界から渡してはいけません。TypeScriptの`number`引数だけではViruneの`Int`入力を保証できないため拒否しますが、Viruneの`Int`戻り値はTypeScriptの`number`へ変換できます。

文脈付きExternal callableでは、JavaScript呼び出しの最後の実引数にある型注釈なしのinline lambda（同期または`async`）について、1個以上の引数を受け取り、固定したProviderが消費されるすべての文脈付き引数を同じcurrent provider generationとworkspaceに属する具体的な非プリミティブExternal object型として暫定的に証明した場合に限り、追加で扱うことができます。この暫定的な文脈証拠はlambda本体を型検査するための入力にしか使ってはいけません。本体の検査後、コンパイラーは確定したVirune callable型をProviderへ再度渡し、最終的なJavaScript呼び出し全体が成功したことを要求してからprojection evidenceを確定しなければなりません。`any`、`unknown`、未解決または曖昧な文脈型、古い証拠またはProviderが一致しない証拠、Virune側の複合値、生のVirune callableやcapability、対応していないcallback shapeをExternal callbackのデータまたは戻り値として受理してはいけません。最終callbackの戻り値にできるのは、最終TypeScript usageが受理したexact External値または`Never`だけで、それ以外のVirune側の戻り値は安全側に失敗しなければなりません。

コンパイラーは、バージョン、コンパイラーが所有する引数・戻り値の分類、非同期かどうか、具体的なeffect、外部からの新規呼び出しとして実行することを含む、Providerに依存しない正規化済みdescriptorを所有します。プリミティブdescriptorでは既存Safe FFIの検証・変換規則を使います。文脈付きExternal descriptorへ記録するのはコンパイラーが所有する`External` markerと、戻らない結果の場合の`Never`だけであり、Provider handle、generation、workspace identity、TypeScript内部の型identityはchecker内部の証明入力に留めなければなりません。生成するJavaScript shimは、すでにExternalである引数と戻り値をVirune側の複合値としてdecodeまたはencodeせず同一性を保って転送し、新しいroot task contextでVirune lambdaを呼び、panic/control-flowのsanitization、同期例外、非同期reject、およびJavaScriptの実引数評価順序を維持しなければなりません。

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
