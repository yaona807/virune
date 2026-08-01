# セルフホスト FFI 境界検証

[English](self-hosting-ffi.md) | [日本語](self-hosting-ffi_ja.md)

この Stage 0 スライスは、JavaScript FFI 規則を独立した決定論的 JSON コントラクトで検証します。JavaScript は実行せず、セルフホスト Checker を Production コンパイラ経路へ接続しません。

## 境界

Host は次を渡します。

- 連続 ID を持つフラットな標準 FFI 型アリーナ
- パラメータ型 ID と戻り値型 ID が解決済みの `extern js` 宣言
- platform、source-relative path、unsafe mode などのモジュールポリシー入力
- 境界型 ID が解決済みの `@jsExport` 宣言

TypeScript AST、JavaScript オブジェクト、モジュールリゾルバ、実行時値はコントラクトを越えません。

## 標準型安全性

Production Checker と同じく、FFI 型を保守的に分類します。

- primitive は `Never` と `InvalidType` を除いて安全
- function、foreign、type variable は不安全
- List、Tuple、`Option`、`Future`、`Result` は再帰的に検証
- `Map` のキーと `Set` の要素は primitive key に限定
- open generic または shape 不明の named type は不安全
- 再帰サイクルは決定論的に停止し、不安全として扱う

アリーナ ID、kind、shape、参照の破損は、件数を限定した `L9001` として返します。

## Extern 検証

safe extern のパラメータは再帰的に安全である必要があり、戻り値は `Result<T, E>` または `Future<Result<T, E>>` が必要です。optional parameter は末尾に限定します。

既存の以下の診断を維持します。

- `L2115`: optional extern parameter の順序
- `L4001`: safe extern が Result を返さない
- `L4006`: Node 以外の platform での `node:` module
- `L4007`: unsafe module ではない場所の unsafe extern
- `L4008`: `ffi/` 外の unsafe extern
- `L4009`: `ffi/` 外の unsafe module
- `L4213`: safe boundary で完全検証できない型

## JavaScript export

`@jsExport`について、function 以外への使用、public、非 generic の具体的シグネチャ、属性引数なし、パラメータと戻り値の再帰的安全性を検証します。`L2052`〜`L2055`と`L4213`を維持します。

## 決定性と対象外

結果の type、extern-function、export ID は連続です。診断順序は Production Checker の module policy、parameter、return、export 検証順に合わせます。同じ入力はバイト単位で同じ JSON を返します。

このスライスは grammar、安定 Compiler API、Runtime ABI、Interop ABI、公開標準ライブラリ、JavaScript wrapper 生成、Production コンパイラ選択を変更しません。
