# JavaScript FFI

[英語版](ffi.md)

## `[ffi.explicit]` 明示的な境界
JavaScriptやnpmの値は`extern js`を通じてViruneへ入ります。通常のインポートでJavaScriptの値を直接信頼することはできません。

## `[ffi.safe]` 安全な`extern`
安全な`extern`は`Result<T, JsError>`またはその非同期版を返します。生成したラッパーは同期例外とPromiseの拒否を捕捉し、値を検証してViruneの表現へ変換します。複合値を安全にデコードするときは走査量を制限し、構造上の安全性を検査します。検証できない入力をVirune側の通常の値（Native値）へ昇格させず、失敗として扱います。

## `[ffi.unsafe]` 検証を省略する`unsafe extern`
`unsafe extern`は検証を省略し、`ffi/`配下で`unsafe module`として宣言されたモジュールでのみ使用できます。

## `[ffi.export]` JavaScriptへの公開
`@jsExport`を使用できるのは公開関数だけです。公開用のラッパーはJavaScriptの引数を検証し、戻り値の`record`、コレクション、`Option`、`Result`、`enum`を文書化されたJavaScript表現へ変換します。必要な場合は末尾の省略可能な引数を渡さず、JavaScriptへ公開するViruneの集約値は防御的にコピーします。外部ハンドル（Foreignハンドル）は外部値のまま保持し、検証済みのNative値として扱いません。

## `[ffi.bytes]` バイナリ値
安全なFFIは`Bytes`として`Uint8Array`または`ArrayBuffer`を受け取り、元のデータをコピーします。JavaScriptへ渡すViruneの`Bytes`もコピーします。JSONでは`Bytes`をbase64文字列として表し、不正なbase64はデコードエラーになります。`record`と`enum`の変換ではVirune Runtimeの型IDを維持し、`Map` / `Set`の変換ではViruneの値をキーとするコレクションの意味を復元します。
