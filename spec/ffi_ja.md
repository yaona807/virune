# JavaScript FFI

[英語版](ffi.md)

## `[ffi.explicit]` 明示的な境界
JavaScriptやnpmの値は`extern js`を通じてViruneへ入ります。通常のインポートでJavaScriptの値を直接信頼することはできません。

## `[ffi.optional-arguments]` 省略可能な`extern`引数
`extern js`の末尾に並ぶ省略可能引数のうち、JavaScript境界表現が`undefined`になる連続した末尾部分は、呼び出しから省略します。後続の引数がある位置の`undefined`は、JavaScriptの引数位置を変えないため保持します。

## `[ffi.safe]` 安全な`extern`
安全な`extern`は`Result<T, JsError>`またはその非同期版を返します。生成したラッパーは同期例外とPromiseの拒否を区別し、値を検証してViruneの表現へ変換します。契約違反と明示的なデコード失敗も、実行失敗とは区別できる状態を保ちます。Virune内部だけで使う制御値やpanicの実体を、生成したJavaScriptコールバック境界からそのまま公開しません。複合値を安全にデコードするときは走査量を制限し、構造上の安全性を検査します。検証できない入力をVirune側の通常の値（Native値）へ昇格させず、失敗として扱います。

## `[ffi.unknown-provenance]` 安全な`Unknown`の由来
互換性のため、Runtime ABI v2の既存の`{ kind: 'unknown' }`型記述子は、値をそのまま通す形式として維持します。一方、コンパイラーが生成する安全な境界では、変更していないRuntime ABI v2の記述子を、別のバージョン付き`virune-safe-ffi/v1`境界エンベロープで包みます。この安全な境界の内側だけで、入れ子の値も含め、すべての`unknown`について値の由来を扱います。

JavaScriptから安全な`Unknown`として取り込んだ、同一性を持つ値は、元のオブジェクトの同一性を維持します。後からTypeScriptの`unknown` / `any`へ戻せるのは、Runtimeがその値を外部由来だと実際に確認した場合だけです。

Virune側で作成した`record`、コレクション、関数、リソース、ケイパビリティなど、同一性を持つVirune固有の値は、`Unknown`へ型を隠しただけでは生のJavaScript値として渡せません。安全な外向けのエンコード処理で拒否します。

一方、`String`、`Bool`、`Float`、`BigInt`のようにRuntimeの表現をそのまま安全に使えるプリミティブ値は、TypeScriptが使い方を検証した`unknown` / `any`引数へ渡せます。境界エンベロープが欠落している、古い、未対応、部分的、不正、または正規の形式ではない場合は、必ず安全側に失敗します。

Safe boundary envelopeはコンパイラー内部のメタデータであり、認証トークンではありません。値の由来に関する保証は、Runtimeが実際に観測した外部値の同一性に基づきます。同一プロセス内で悪意を持って値が改ざんされた場合の耐性を提供するものではありません。既存のRuntime ABI v2における`unknown`記述子や、JSONのエンコード規則も変更しません。

## `[interop.ecmascript-canonical-identity]` ECMAScriptの標準identity
現在の直接相互運用（Direct Interop）でJavaScriptの標準的な概念の同一性が必要な場合、TypeScriptプロバイダーが固定されたProgramスナップショット内で意味上の同一性を証明できたときに限り、コンパイラーが管理する決定的な同一性を記録します。このバージョンで提供する同一性は、ECMAScriptのグローバルな`Promise`そのものを表す`ecmascript:Promise`だけです。同じ`Promise`が`lib.es`、Web / DOM、Node、npmの宣言群を経由して参照されても、同一性は変わりません。

標準的な同一性を判断するときは、パッケージ名、宣言ファイル名や絶対パス、TypeScript内部のオブジェクトID、表示用の`typeToString()`だけを根拠にしてはいけません。構造が似ているだけのthenableや、未対応・型が不明な値を`ecmascript:Promise`と推測することもできません。

Provider内部の検証結果は、安定したコンパイラーの証拠へ定数の同一性として取り込みます。古いProviderへの参照は、従来どおり無効です。

## `[ffi.unsafe]` 検証を省略する`unsafe extern`
`unsafe extern`は検証を省略し、`ffi/`配下で`unsafe module`として宣言されたモジュールでのみ使用できます。

## `[ffi.export]` JavaScriptへの公開
`@jsExport`を使用できるのは公開関数だけです。公開用のラッパーはJavaScriptの引数を検証し、戻り値の`record`、コレクション、`Option`、`Result`、`enum`を文書化されたJavaScript表現へ変換します。JavaScriptへ公開するViruneの集約値は防御的にコピーします。

## `[ffi.bytes]` バイナリ値
安全なFFIは`Bytes`として`Uint8Array`または`ArrayBuffer`を受け取り、元のデータをコピーします。JavaScriptへ渡すViruneの`Bytes`もコピーします。JSONでは`Bytes`をbase64文字列として表し、不正なbase64はデコードエラーになります。`record`と`enum`の変換ではVirune Runtimeの型IDを維持し、`Map` / `Set`の変換ではViruneの値をキーとするコレクションの意味を復元します。
