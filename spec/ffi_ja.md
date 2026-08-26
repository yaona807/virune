# JavaScript FFI

[英語版](ffi.md)

## `[ffi.explicit]` 明示的な境界
JavaScriptやnpmの値は`extern js`を通じてViruneへ入ります。通常のインポートでJavaScriptの値を直接信頼することはできません。

## `[ffi.safe]` 安全な`extern`
安全な`extern`は`Result<T, JsError>`またはその非同期版を返します。生成したラッパーは同期例外とPromiseの拒否を捕捉し、値を検証してViruneの表現へ変換します。複雑で未検証のオブジェクトは`Unknown`として受け取り、デコードすることを推奨します。

## `[ffi.unsafe]` 検証を省略する`unsafe extern`
`unsafe extern`は検証を省略します。使用できるのは、`ffi/`配下で`unsafe module`として宣言されたモジュールだけです。`unsafe extern`宣言は明示的な監査境界であり、不変性や型に関する前提を壊す可能性があります。

## `[ffi.export]` JavaScriptへの公開
`@jsExport`を使用できるのは公開関数だけです。公開用のラッパーはJavaScriptの引数を検証し、戻り値の`record`、コレクション、`Option`、`Result`、`enum`を文書化されたJavaScript表現へ変換します。

## `[ffi.binding]` 宣言生成
`virune bind`はTypeScript宣言ファイルを保守的に変換します。`any`と未対応の構文は`Unknown`になり、オーバーロードは別名の生成または手動確認が必要です。生成したバインディングは自動的には信頼されません。

## `[ffi.bytes]` バイナリ値
安全なFFIは`Bytes`として`Uint8Array`または`ArrayBuffer`を受け取り、元のデータをコピーします。JavaScriptへ渡すViruneの`Bytes`もコピーします。JSONでは`Bytes`をbase64文字列として表し、不正なbase64はデコードエラーになります。`record`と`enum`の変換ではVirune Runtimeの型IDを維持し、`Map` / `Set`の変換ではViruneの値をキーとするコレクションの意味を復元します。

## 3段階の相互運用
詳しい設計は[JavaScript相互運用モデル](js-interop_ja.md)を参照してください。外部オブジェクト（Foreignオブジェクト）は同一性とプロトタイプを維持します。Virune側の複合値（Native複合値）へ変換する場合だけ、明示的なコーデックを使用します。
