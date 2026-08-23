# JavaScript FFI

[英語版](ffi.md)

## `[ffi.explicit]` 明示的な境界
通常のnpm / JavaScriptパッケージは、`import js`から元のJavaScriptを直接利用します。単純なAPIはTypeScript宣言を参照する保守的なFacadeで検査し、複雑なAPIは事前にコンパイルした`*.interop.ts` Adapterへ分離します。`extern js`はレビュー可能なSafe Adapterとして、`unsafe extern`は最後の動的な境界として残します。

## `[ffi.safe]` Safe extern
Safe externは`Result<T, JsError>`またはその非同期版を返します。生成したラッパーは同期例外とPromiseのrejectを捕捉し、値を検証してViruneの表現へ変換します。複雑で未検証のオブジェクトは`Unknown`で受け取り、デコードしてください。

## `[ffi.unsafe]` Unsafe extern
`unsafe extern`は検証を省略します。使用できるのは`ffi/`配下の`unsafe module`だけです。Unsafe宣言は明示的な監査境界であり、不変性や型の前提を壊す可能性があります。

## `[ffi.export]` JavaScript export
`@jsExport`を使用できるのは公開関数だけです。公開用のラッパーはJavaScriptの引数を検証し、`record`、コレクション、Option、Result、`enum`の戻り値を文書化されたJavaScript表現へ変換します。

## `[ffi.binding]` 宣言生成
`virune bind`はTypeScript宣言を保守的に変換します。`any`と未対応の構文は`Unknown`になり、オーバーロードは別名の生成または手動確認が必要です。生成したバインディングを自動的に信頼してはいけません。

## `[ffi.bytes]` バイナリ値
Safe FFIは`Bytes`として`Uint8Array`または`ArrayBuffer`を受け取り、元のデータをコピーします。JavaScriptへ渡すViruneの`Bytes`もコピーします。JSONでは`Bytes`をbase64文字列として表し、不正なbase64はデコードエラーになります。`record` / `enum`変換ではVirune Runtimeの型IDを維持し、Map / Set変換では値をキーとするコレクションの意味を復元します。

## Three-Tier Interop
詳しい設計は[JavaScript相互運用モデル](js-interop_ja.md)を参照してください。Foreignオブジェクトはコピーせず、同一性とプロトタイプを維持します。Native複合値へ変換する場合だけ、明示的なCodecを使用します。
