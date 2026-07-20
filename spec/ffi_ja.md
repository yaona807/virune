# JavaScript FFI

[English](ffi.md) | [日本語](ffi_ja.md)

## `[ffi.explicit]` 明示的境界
通常のnpm／JavaScript packageは`import js`から元のJavaScriptを直接利用します。単純APIはTypeScript宣言を参照する保守的Facadeで検査し、複雑なAPIは事前compileした`*.interop.ts` Adapterへ隔離します。`extern js`はreview可能なSafe Adapter、`unsafe extern`は最後の動的境界として残します。

## `[ffi.safe]` Safe extern
Safe externは`Result<T, JsError>`またはasync相当を返します。生成wrapperは同期例外とPromise rejectionを捕捉し、値を検証してVirune表現へ変換します。複雑で未検証なobjectは`Unknown`で受け取り、decodeしてください。

## `[ffi.unsafe]` Unsafe extern
`unsafe extern`は検証を省略します。`ffi/`配下の`unsafe module`だけで許可します。Unsafe宣言は明示的な監査境界であり、不変性や型前提を破壊する可能性があります。

## `[ffi.export]` JavaScript export
`@jsExport`はpublic functionだけに使用できます。export wrapperはJavaScript引数を検証し、record、collection、Option、Result、enumの戻り値を文書化されたJavaScript表現へ変換します。

## `[ffi.binding]` 宣言生成
`virune bind`はTypeScript宣言を保守的に変換します。`any`と未対応構文は`Unknown`になり、overloadは別名生成または手動確認が必要です。生成bindingを自動的に信頼してはいけません。

## `[ffi.bytes]` Binary値
Safe FFIは`Bytes`として`Uint8Array`または`ArrayBuffer`を受理し、基礎dataをcopyします。JavaScriptへ渡すVirune Bytesもcopyします。JSONではBytesをbase64文字列にし、不正base64はdecode errorです。record／enum変換はVirune Runtime type IDを維持し、Map／Set変換は値比較collectionの意味論を復元します。

## Three-Tier Interop
詳細な設計は[`js-interop_ja.md`](js-interop_ja.md)を参照してください。Foreign objectはcopyせずidentityとprototypeを維持し、Native複合値への変換時だけ明示Codecを使用します。
