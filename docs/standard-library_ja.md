# 標準ライブラリ

[English](standard-library.md)

標準ライブラリは型と関数のmoduleを中心に構成し、別のdispatch機構を導入しません。

## Core値

- `Bool`、`Int`、`Float`、`BigInt`、`String`、`Unit`、`Never`、`Unknown`
- `Option<T>`、1段のcanonical表記`T?`
- `Result<T, E>`
- Tupleと関数

## Collection

- `List<T>` — 不変の順序付き値
- `Map<K, V>` — 構造的keyを持つ不変Map
- `Set<T>` — 構造的keyを持つ不変Set
- `Queue<T>`、`Stack<T>` — ライブラリdata structure

Listの主要APIは`map`、`filter`、`fold`、`find`、`unique`、`uniqueBy`、`sortBy`です。独自の等価性を定義せずdomain固有比較を表す場合は`uniqueBy`を使用します。

Map／Set keyはCompiler定義の構造的Eq／Hashを満たす必要があります。利用者はcustom Eq／Hashをinstallできません。

## TextとBinary

- `String` APIはUnicodeを考慮し、必要に応じてcode unit、code point、grapheme clusterを区別します。
- `Byte`は`0..255`を検査するnewtype integerです。
- `Bytes`は不変で、JavaScript境界ではcopyします。
- `MutableBytes`は明示的に可変で、不変境界を跨ぐときにcopyします。
- 固定幅整数moduleは検査付き変換と演算を提供します。

## 失敗とValidation

`Validation<T, E>`は`Result<T, List<E>>`の透過的aliasです。`Validation` moduleは複数errorの蓄積helperを提供し、別の言語型ではありません。

## EffectとPlatform module

Platform関数は固定の組み込みeffectを宣言します。

```text
Console.print(message: String) -> Unit uses Console
File.readText(path: String) -> Result<String, FileError> uses File
Http.get(url: String) -> Result<HttpResponse, HttpError> uses Network
Task.sleep(duration: Duration) -> Future<Unit> uses Timer, Task
```

Global `print`はありません。Effectを見える状態にするため`Console.print`を使用します。

## TaskとStream

TaskとStreamは構造化Runtime scopeを利用する通常のライブラリAPIです。Retry、timeout、race、supervision、stream変換はライブラリ関数です。`parallel`と`parallel try`は異種型の名前付きtask group用言語構文として残します。

## DebugとJSON derive

`derives Eq, Hash, Debug, Json`は対応する処理のCompiler生成を要求します。`Clone`とユーザー定義deriveはありません。`Debug`は明示opt-inで、安全に表現できないfieldを含む場合は拒否します。
