# JavaScript FFI

[英語版](ffi.md)

## `[ffi.explicit]` 明示的な境界
JavaScriptやnpmの値は`extern js`を通じてViruneへ入ります。通常のインポートでJavaScriptの値を直接信頼することはできません。

## `[ffi.optional-arguments]` 省略可能な`extern`引数
`extern js`の末尾に並ぶ省略可能引数のうち、JavaScript境界表現が`undefined`になる連続した末尾部分は、呼び出しから省略します。後続の引数がある位置の`undefined`は、JavaScriptの引数位置を変えないため保持します。

## `[ffi.safe]` 安全な`extern`
安全な`extern`は`Result<T, JsError>`またはその非同期版を返します。生成したラッパーは同期例外とPromiseの拒否を区別し、値を検証してViruneの表現へ変換します。契約違反と明示的なデコード失敗も、実行失敗とは区別できる状態を保ちます。Virune内部だけで使う制御値やpanicの実体を、生成したJavaScriptコールバック境界からそのまま公開しません。複合値を安全にデコードするときは走査量を制限し、構造上の安全性を検査します。検証できない入力をVirune側の通常の値（Native値）へ昇格させず、失敗として扱います。

## `[ffi.unknown-provenance]` 安全な`Unknown`の由来
Runtime ABI v2の既存`{ kind: 'unknown' }`型descriptorは、互換性のためraw pass-throughとして維持します。コンパイラが生成する安全な境界では、変更していないRuntime v2型descriptorの外側に、別のversioned `virune-safe-ffi/v1`境界envelopeを付けます。このSafe boundaryの内部でだけ、入れ子を含むすべての`unknown`を由来付きとして扱います。

JavaScriptから安全な`Unknown`としてデコードしたidentity-bearingな値は、元のobject identityを維持します。その値を後からTypeScriptの`unknown` / `any`境界へ戻せるのは、Runtimeがforeign-originであることを実際に観測している場合だけです。Virune側で作った`record`、collection、callable、resource、capabilityなどのidentity-bearingなNative値は、`Unknown`へ型消去しただけではraw JavaScript valueとして公開できず、安全なoutbound encodingで拒否されます。一方、`String`、`Bool`、`Float`、`BigInt`などRuntime表現をそのまま安全に扱えるNative primitiveは、TypeScriptがそのusageを証明した`unknown` / `any` parameterへ渡せます。Safe boundary envelopeがmissing、stale、unsupported、partial、malformed、またはその他の理由でnon-canonicalならfail closedです。

Safe boundary envelopeはコンパイラ内部用metadataであり、authentication tokenではありません。provenance保証はRuntimeが実際に観測したforeign identityに基づき、同一process内の敵対的改ざんへの耐性を提供する仕組みではありません。既存Runtime ABI v2の`unknown` descriptorやJSON encodingの意味も変更しません。

## `[ffi.unsafe]` 検証を省略する`unsafe extern`
`unsafe extern`は検証を省略し、`ffi/`配下で`unsafe module`として宣言されたモジュールでのみ使用できます。

## `[ffi.export]` JavaScriptへの公開
`@jsExport`を使用できるのは公開関数だけです。公開用のラッパーはJavaScriptの引数を検証し、戻り値の`record`、コレクション、`Option`、`Result`、`enum`を文書化されたJavaScript表現へ変換します。JavaScriptへ公開するViruneの集約値は防御的にコピーします。

## `[ffi.bytes]` バイナリ値
安全なFFIは`Bytes`として`Uint8Array`または`ArrayBuffer`を受け取り、元のデータをコピーします。JavaScriptへ渡すViruneの`Bytes`もコピーします。JSONでは`Bytes`をbase64文字列として表し、不正なbase64はデコードエラーになります。`record`と`enum`の変換ではVirune Runtimeの型IDを維持し、`Map` / `Set`の変換ではViruneの値をキーとするコレクションの意味を復元します。
