# JavaScript相互運用モデル

[英語版](js-interop.md)

低レベルの`extern js`規則は[JavaScript FFI](ffi_ja.md)で定めます。

## `[interop.direct]` 直接利用（Direct Facade）

`import js`では、型宣言のあるJavaScript APIのうち、安全に扱えると確認できた範囲だけを利用できます。依存パッケージのソースコードは変換せず、そのまま実行します。

対応するのは、デフォルトインポート、名前付きインポート、名前空間インポート、副作用のみのインポート、名前付きの型専用インポート、プロパティ参照、関数・メソッド呼び出し、外部ハンドル（Foreignハンドル）の受け渡しです。型宣言上Promise互換（Promise-like）の戻り値には`await`も使用できます。

JavaScriptの呼び出しは、Providerが呼び出し先と実引数の型だけを使って解決します。Virune側で期待する戻り値の型を、オーバーロードやジェネリクスの選択に使ってはいけません。

戻り値にしか現れないジェネリックパラメーターは、TypeScriptのデフォルト値または基底制約から確定できる場合に限り解決できます。呼び出し先と実引数の型だけで対応する呼び出しを1つに絞れない場合は、アダプターを使わなければなりません。

Virune側の関数を対応しているJavaScriptのコールバック位置へ渡せるのは、後述する生成コールバック境界を経由する場合だけです。Virune関数の生の実行時表現をJavaScriptへ直接渡してはいけません。

CommonJSとして実行されるモジュールからの名前付きインポートは拒否します。ブラウザやバンドラーで実際に使う実行時モジュールの解決は、バンドラーの責任です。

ソースコードの検査が終わっても、ビルド段階で確認する`runtime-resolution`（実行時のモジュール解決）の義務が残る場合があります。`check`で診断エラーが出なかっただけでは、実行が許可されたことにはなりません。`virune run`または`virune test`で生成JavaScriptを実行する前に、実際に実行されるモジュールの依存関係全体について、すべての実行時モジュール読み込みに対応する、当該ビルドと一致したプロバイダー非依存の解決証拠が揃い、義務が解消されていなければなりません。保留中、未解決、欠落、不正、矛盾のある証拠は安全側に失敗させ、Node.jsを起動してはなりません。

TypeScriptで`any`と宣言されたインポートは、直接利用では拒否します。TypeScriptの`unknown`は型が不明な外部値として保持し、より狭い型を仮定せずにViruneの`Unknown`へ渡せます。

### 文脈付きExternal操作

文脈付き集約リテラル`{ field: value }`を通常のJavaScriptオブジェクトとして扱えるのは、固定したProviderが、期待される`External`構造型に対してオブジェクトの使い方全体を検証できた場合だけです。期待する型は、JavaScriptの名前付き型専用インポートから取得することもできます。この場合、実行時のインポートは追加しません。

入れ子の集約リテラルや、対応するVirune関数をプロパティに指定した場合も、同じTypeScriptの使い方全体で検証します。プロパティの不足や余分なプロパティ、型の不一致、古い・部分的・不正な証拠、`any`、`unknown`は拒否しなければなりません。Viruneの`record`、`List`、タプルなどを、JavaScriptオブジェクトへ暗黙に変換してはいけません。

文脈付きオブジェクトのプロパティは、左から右へ、それぞれ正確に1回評価します。プロパティ名は計算されたデータプロパティとして出力するため、`__proto__`のような名前でもオブジェクトのプロトタイプは変更されず、通常のオブジェクト自身が持つデータプロパティとして扱われます。Virune関数をプロパティに指定するときは、後述する生成コールバック境界を使います。Virune関数の生の実行時表現をJavaScriptオブジェクトへ漏らしてはなりません。

`value[index]`でインデックス参照できるのは、実際の対象とインデックスに対して、TypeScriptが参照可能だと証明できた場合だけです。対象とインデックスはJavaScriptの評価順に従い、それぞれ1回だけ評価します。結果は、許可されたBridgeによって変換するまでは外部値として扱います。未対応のインデックス、未解決の参照、`any`や`unknown`の証拠は拒否しなければなりません。

`External`値のプロパティやインデックスへ代入できるのは、その代入をTypeScriptが許可した場合だけです。`readonly`など書き込みできない対象への代入は拒否しなければなりません。

生成するJavaScriptは、元の参照の意味と評価順を維持します。プロパティ代入では対象、値の順、インデックス代入では対象、インデックス、値の順に評価します。setter、Proxyのトラップ、同期例外もJavaScriptの動作をそのまま保ちます。

通常の関数呼び出しとして解決できず、Providerが呼び出し先と実引数からコンストラクターとして使えることを証明した場合に限り、コンストラクター呼び出しを生成できます。関数としてもコンストラクターとしても使える値は曖昧なので、勝手にコンストラクターだと判断してはいけません。

アクセスできない`private`コンストラクター、戻り値の型が決まらないジェネリクス、不正または古い証拠、未対応のコンストラクター選択は拒否しなければなりません。対応するオーバーロードやジェネリクスの選択は、実引数だけを使ってTypeScriptに委ねます。生成コードでは、JavaScriptのコンストラクター呼び出しの意味、引数の評価順、例外の動作を維持します。

文脈付きオブジェクト、インデックス参照、代入、コンストラクター呼び出しの検証結果は、Providerに依存しない`External Operation`の証拠として記録しなければなりません。Provider内部のハンドルや生成番号は型検査時の証拠としてのみ使い、安定した操作の出力へ含めてはいけません。

コンパイラーはコードを生成する前に、証拠が現在のものであり、完全かつ正規の構造を持ち、実際の使用箇所に対応していることを確認しなければなりません。TypeScriptの一般的な代入互換性をVirune側で再実装してはいけません。

### 生成コールバック境界

Virune関数をJavaScriptへコールバックとして渡せるのは、固定したProviderがJavaScriptの呼び出し全体を1つに確定し、引数に対応するコールバック型を安全に扱えると証明した場合だけです。

証拠が欠落している、古い、不正、曖昧、未解決、または`unknown`である場合は拒否し、アダプターを要求しなければなりません。コンストラクター専用の値、未解決のジェネリクス、省略可能引数や可変長引数を持つ型、必須プロパティ付きの呼び出し可能なオブジェクトも対象外です。TypeScriptの`any`は、後述するコールバック戻り値の限定的な処理を除き対応しません。TypeScriptの一般的な代入互換性をViruneコンパイラーで再実装してはいけません。

TypeScriptで明示された`this`引数を取り除けるのは、次の条件を両方満たす場合だけです。

- 固定したProviderが、`this`に依存しない具体的なVirune関数を使ったJavaScript呼び出し全体を受理している
- 選択したコールバックが、`this`以外の点で既存の生成コールバックの形式に適合している

この`this`はTypeScript側だけの型情報として扱います。Virune側で型を分類し直すこと、値として取り出すこと、デコードすること、コールバック引数として公開すること、正規化したコールバックの記述子や安定した検証結果に含めることは禁止します。

TypeScriptで`thisParameter`として解決できない場合や、呼び出し全体またはコールバックの形式に関する証拠が欠落・古い・不正・曖昧・未対応である場合は拒否しなければなりません。

プリミティブcallableとして対応するのは、名前付きで非ジェネリック、かつ`@jsExport`ではないVirune関数のうち、引数と戻り値が対応プリミティブ型または`Unit`だけで構成され、effect集合が具体的に確定しているものです。加えて、JavaScript呼び出しの実引数位置にある同期の引数0個inline lambdaは、戻り値が対応プリミティブ型または`Unit`でeffect集合が具体的に確定している場合に限って扱うことができます。このlambdaがcaptureした値は通常のlexical closure stateのままであり、callable境界の引数や戻り値として検査・encode・再分類してはいけません。境界を越えるのは生成JavaScript shimだけで、固定されたProviderは0引数callbackを含む最終的なJavaScript呼び出し全体を引き続き受理しなければなりません。`uses *`、境界を通るVirune側の複合値、`Unknown`へ型消去された値をこのプリミティブ境界から渡してはいけません。TypeScriptの`number`引数だけではViruneの`Int`入力を保証できないため拒否しますが、Viruneの`Int`戻り値はTypeScriptの`number`へ変換できます。

文脈付きExternal callableでは、JavaScript呼び出しの最後の実引数にある型注釈なしのinline lambda（同期または`async`）について、1個以上の引数を受け取り、固定したProviderが消費されるすべての文脈付き引数を同じcurrent provider generationとworkspaceに属する具体的な非プリミティブExternal object型として暫定的に証明した場合に限り、追加で扱うことができます。この暫定的な文脈証拠はlambda本体を型検査するための入力にしか使ってはいけません。本体の検査後、コンパイラーは確定したVirune callable型をProviderへ再度渡し、最終的なJavaScript呼び出し全体が成功したことを要求してからprojection evidenceを確定しなければなりません。`any`、`unknown`、未解決または曖昧な文脈型、古い証拠またはProviderが一致しない証拠、Virune側の複合値、生のVirune callableやcapability、対応していないcallback shapeをExternal callbackのデータまたは戻り値として受理してはいけません。最終callbackの戻り値にできるのは、最終TypeScript usageが受理したexact External値または`Never`だけで、それ以外のVirune側の戻り値は安全側に失敗しなければなりません。

コンパイラーは、バージョン、コンパイラーが所有する引数・戻り値の分類、非同期かどうか、具体的なeffect、外部からの新規呼び出しとして実行することを含む、Providerに依存しない正規化済みdescriptorを所有します。プリミティブdescriptorでは既存Safe FFIの検証・変換規則を使います。文脈付きExternal descriptorへ記録するのはコンパイラーが所有する`External` markerと、戻らない結果の場合の`Never`だけであり、Provider handle、generation、workspace identity、TypeScript内部の型identityはchecker内部の証明入力に留めなければなりません。生成するJavaScript shimは、すでにExternalである引数と戻り値をVirune側の複合値としてdecodeまたはencodeせず同一性を保って転送し、新しいroot task contextでVirune lambdaを呼び、panic/control-flowのsanitization、同期例外、非同期reject、およびJavaScriptの実引数評価順序を維持しなければなりません。

TypeScriptの`void`は、Viruneの関数が返した値を自由に捨ててよいという意味ではありません。同期の`() => void`に渡せるのは、同期で`Unit`を返すVirune関数だけです。非同期の`Promise<void>`に渡せるのは、非同期で`Unit`を返すVirune関数だけです。

TypeScriptのcallback targetの戻り値が`any`であることだけでは、生成境界を一般に許可しません。固定したProviderが呼び出し全体を受理した後に限り、同期で`Unit`を返すVirune callbackは、コンパイラーが所有する`undefined`表現を使ってそのtarget戻り値をdischargeできます。これは既知の外向き表現`Unit`から`undefined`への変換だけであり、`any`自体を安定した証拠にしたり、外部値からVirune型へのnarrowingを許可したりしてはいけません。非同期callback、または`Unit`以外のVirune側の戻り値を持つcallbackは、`any` target resultに対して安全側に失敗しなければなりません。

生成したJavaScript関数の同一性は、Virune関数自体の同一性と正規化済み境界descriptorの組で決まります。同じ関数を同じdescriptorで繰り返し変換した場合は同じJavaScript関数オブジェクトを返し、同じ関数でもdescriptorが異なる場合は同じJavaScript関数オブジェクトを共有してはいけません。バージョン付きcacheはVirune関数上の列挙されないコンパイラー内部プロパティとして保持します。この仕組みのために公開project helper、origin export、Runtime ABI entry point、FFI ABI entry pointを追加してはいけません。

安定したprojection evidenceには、生成された`callable-shim`であること、正規化済みdescriptor、Virune側が保証する安全性と未解決の義務、コールバックの実引数index、External Operation列での挿入indexを含めなければなりません。checker内部だけで使うusage indexを安定したcontractへ含めてはいけません。

## `[interop.foreign-values]` 外部値（Foreign値）

外部値はJavaScriptの値として扱います。オブジェクトの同一性、プロトタイプ、メソッドの呼び出し元、Promiseの動作、モジュールのバインディングは維持されます。別の外部関数へそのまま渡すこともできます。

Viruneの算術演算、比較、パターンマッチ、コレクションの規則、Virune固有の型のメソッドを使う場合は、先にBridgeでViruneの型へ変換しなければなりません。

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
