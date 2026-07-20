# Virune language guide

[日本語](language-guide_ja.md)

## 1. Small language core

Virune programs are built from functions, records, enums, newtypes, type aliases, generics, collections, `Option`, `Result`, and pattern matching. The language deliberately has no classes, inheritance, macros, user-defined protocols, or implicit implementation search.

## 2. Functions

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

Arrow bodies are for a single expression. Block bodies are for statements and early return.

## 3. Records, enums, newtypes, and aliases

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

A `newtype` creates a nominal type. Direct construction is limited to its declaring module. A `type` alias is transparent.

## 4. Option and Result

```virune
fn displayName(user: User?) -> String? {
	let value = user?
	return Some(value.name)
}

fn load(id: UserId) -> Result<User, UserError> {
	return Err(UserError.NotFound(id))
}
```

`T?` is the canonical one-level Option spelling. `Some`, `None`, `Ok`, and `Err` are explicit values. `?` propagates compatible absence or failure.

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

Matches over enums, Option, and Result must be exhaustive. OR patterns, guards, record patterns, tuple patterns, list patterns, literals, wildcard, and inclusive integer ranges are supported.

## 6. Composition without protocols

Reusable behaviour is an ordinary record of functions.

```virune
record Encoder<T> {
	encode: fn(T) -> String
}

fn save<T>(value: T, encoder: Encoder<T>) -> String {
	return encoder.encode(value)
}
```

This is the standard approach for codecs, comparators, repositories, logging, clocks, test doubles, and dependency injection. Implementations are explicit values and cannot be selected implicitly.

## 7. Equality and hashing

`Eq` and `Hash` are compiler-derived structural capabilities. User code cannot redefine equality or hashing.

```virune
record Point derives Eq, Hash {
	x: Int
	y: Int
}
```

For domain-specific comparison, use a normalized newtype or an explicit key function such as `List.uniqueBy` or `List.sortBy`.

## 8. Effects

Virune has a closed set of built-in effects, including `Console`, `File`, `Process`, `Network`, `Timer`, `Clock`, `Storage`, `Dom`, `Random`, `JavaScript`, and `Task`.

```virune
fn announce(message: String) -> Unit uses Console {
	Console.print(message)
}
```

Users cannot declare capability names. Domain dependencies are records passed as values.

`uses *` is allowed only for non-escaping callback parameters:

```virune
fn apply<T, U>(value: T, transform: fn(T) -> U uses *) -> U uses * {
	return transform(value)
}
```

The callback cannot be stored, returned, captured, or placed in an aggregate.

## 9. Async and structured concurrency

```virune
async fn loadBoth() -> Result<(User, Settings), LoadError> uses Network, Task {
	let values = await (parallel try {
		user: loadUser()
		settings: loadSettings()
	})?
	return Ok((values.user, values.settings))
}
```

Child tasks belong to their parent scope. Failure and cancellation settle sibling tasks before the parent continues. Detached tasks are not part of normal Virune code.

## 10. Cleanup

```virune
fn read(path: String) -> Result<String, FileError> uses File {
	let handle = File.open(path)?
	defer File.close(handle)
	return File.readAll(handle)
}
```

`defer` runs in LIFO order across normal return, early return, `?`, panic, and asynchronous cleanup.

## 11. Must-use values

`Result`, futures, resources, streams, and `@mustUse` declarations cannot be silently ignored. Use the value or write `discard expression` to make intentional loss visible.

## 12. JavaScript boundary

```virune
import js { nanoid } from "nanoid"
```

JavaScript values are validated through descriptors. Unsupported or semantically unsafe TypeScript shapes become `Unknown` and require explicit decoding or an adapter. See [JavaScript interoperability](js-interop.md).

## 13. Documentation comments

Use `//` for ordinary comments, `///` for the following declaration, and `//!` for the current source module.

```virune
//! User lookup services.

/// Returns the user identified by `id`.
///
/// # Errors
///
/// Returns `UserError.NotFound` when the user does not exist.
pub fn findUser(id: UserId) -> Result<User, UserError> {
	return Err(UserError.NotFound(id))
}
```

Documentation text is CommonMark-compatible Markdown. `////` remains an ordinary comment, and Virune 1.0 has no block comments. See the [normative documentation-comment specification](../spec/documentation.md).
