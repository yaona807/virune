# Virune言語ガイド

[English](language-guide.md)

## 1. 小さな言語核

Viruneは関数、record、enum、newtype、type alias、generic、collection、`Option`、`Result`、pattern matchingで構成します。Class、継承、macro、ユーザー定義protocol、暗黙implementation探索はありません。

## 2. 関数

```virune
fn add(left: Int, right: Int) -> Int => left + right

fn normalize(value: String) -> Result<String, String> {
	let trimmed = String.trim(value)
	if trimmed == "" {
		return Err("empty")
	}
	return Ok(trimmed)
}
```

Arrow bodyは単一式、block bodyはstatementと早期returnに使用します。

## 3. Record、Enum、Newtype、Alias

```virune
pub newtype UserId = Int

type Headers = Map<String, List<String>>

record User derives Eq, Hash, Debug, Json {
	id: UserId
	name: String
	nickname: String?
}

enum UserError derives Eq, Debug, Json {
	NotFound(UserId)
	InvalidName(String)
}
```

`newtype`は名前的型を作り、直接構築は宣言module内に限定します。`type` aliasは透過的です。

## 4. OptionとResult

```virune
fn displayName(user: User?) -> String? {
	let value = user?
	return Some(value.name)
}

fn load(id: UserId) -> Result<User, UserError> {
	return Err(UserError.NotFound(id))
}
```

1段のOptionは`T?`をcanonical表記にします。`Some`、`None`、`Ok`、`Err`は明示値です。`?`は互換する不在または失敗を伝播します。

## 5. Pattern matching

```virune
fn message(error: UserError) -> String {
	return match error {
		UserError.NotFound(_) => "missing"
		UserError.InvalidName(value) if value == "" => "empty"
		UserError.InvalidName(value) => value
	}
}
```

Enum、Option、Resultのmatchは網羅的でなければなりません。OR、guard、record、tuple、list、literal、wildcard、inclusive integer range patternを利用できます。

## 6. Protocolを使わない合成

再利用する振る舞いは関数fieldを持つ通常のrecordで表します。

```virune
record Encoder<T> {
	encode: fn(T) -> String
}

fn save<T>(value: T, encoder: Encoder<T>) -> String {
	return encoder.encode(value)
}
```

Codec、comparator、repository、logger、clock、test double、dependency injectionはこの方式を使用します。実装は明示的な値であり、暗黙選択されません。

## 7. EqとHash

`Eq`と`Hash`はCompilerが生成する構造的能力です。利用者は等価性やHashの意味を変更できません。

```virune
record Point derives Eq, Hash {
	x: Int
	y: Int
}
```

Domain固有の比較は、正規化済みnewtypeまたは`List.uniqueBy`、`List.sortBy`などのkey functionで表現します。

## 8. Effect

Viruneは`Console`、`File`、`Process`、`Network`、`Timer`、`Clock`、`Storage`、`Dom`、`Random`、`JavaScript`、`Task`など、閉じた組み込みeffect集合を持ちます。

```virune
fn announce(message: String) -> Unit uses Console {
	Console.print(message)
}
```

利用者はcapability名を追加できません。Domain dependencyはrecord値として引数で渡します。

`uses *`は非escape callback parameterだけに使用できます。

```virune
fn apply<T, U>(value: T, transform: fn(T) -> U uses *) -> U uses * {
	return transform(value)
}
```

Callbackを保存、return、capture、aggregate格納できません。

## 9. Asyncと構造化並行処理

```virune
async fn loadBoth() -> Result<(User, Settings), LoadError> uses Network, Task {
	let values = await (parallel try {
		user: loadUser()
		settings: loadSettings()
	})?
	return Ok((values.user, values.settings))
}
```

Child taskはparent scopeに所属します。失敗やcancel時はsiblingの終了処理を待ってからparentが継続します。通常コードにdetached taskはありません。

## 10. Cleanup

```virune
fn read(path: String) -> Result<String, FileError> uses File {
	let handle = File.open(path)?
	defer File.close(handle)
	return File.readAll(handle)
}
```

`defer`は通常return、早期return、`?`、panic、async cleanupでLIFO実行します。

## 11. Must-use値

`Result`、Future、resource、stream、`@mustUse`宣言は黙って無視できません。値を使用するか、意図的な破棄を`discard expression`で明示します。

## 12. JavaScript境界

```virune
import js { nanoid } from "nanoid"
```

JavaScript値はdescriptorで検証します。安全に検証できないTypeScript型は`Unknown`となり、明示decodeまたはAdapterが必要です。[JavaScript連携](js-interop_ja.md)を参照してください。
