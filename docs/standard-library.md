# Standard library

[日本語](standard-library_ja.md)

The standard library is primarily modules of types and functions. It does not introduce another dispatch system.

## Core values

- `Bool`, `Int`, `Float`, `BigInt`, `String`, `Unit`, `Never`, `Unknown`
- `Option<T>`, canonical one-level spelling `T?`
- `Result<T, E>`
- tuples and functions

## Collections

- `List<T>` — immutable ordered values
- `Map<K, V>` — immutable structurally keyed map
- `Set<T>` — immutable structurally keyed set
- `Queue<T>`, `Stack<T>` — library data structures

Important List operations include `map`, `filter`, `fold`, `find`, `unique`, `uniqueBy`, and `sortBy`. `uniqueBy` is the preferred way to express domain-specific equivalence without redefining equality.

Map and Set keys must support compiler-defined structural Eq and Hash. User code cannot install custom Eq or Hash implementations.

## Text and binary data

- `String` operations are Unicode-aware; APIs distinguish code units, code points, and grapheme clusters where relevant.
- `Byte` is a checked newtype integer in `0..255`.
- `Bytes` is immutable and copied at JavaScript boundaries.
- `MutableBytes` is explicitly mutable and copies when crossing the immutable boundary.
- fixed-width integer modules provide checked conversion and arithmetic.

## Failure and validation

`Validation<T, E>` is a transparent alias for `Result<T, List<E>>`. The `Validation` module provides accumulation helpers; it is not a separate language type.

## Effects and platform modules

Platform functions declare fixed built-in effects, for example:

```text
Console.print(message: String) -> Unit uses Console
File.readText(path: String) -> Result<String, FileError> uses File
Http.get(url: String) -> Result<HttpResponse, HttpError> uses Network
Task.sleep(duration: Duration) -> Future<Unit> uses Timer, Task
```

There is no global `print`; use `Console.print` so the effect remains visible.

## Tasks and streams

Task and Stream are ordinary library APIs backed by structured runtime scopes. Retry, timeout, race, supervision, and stream transformations remain library functions. `parallel` and `parallel try` are language forms for heterogeneous named task groups.

## Debug and JSON derives

`derives Eq, Hash, Debug, Json` asks the compiler to generate supported behaviour. `Clone` and user-defined derives do not exist. `Debug` must be opted into and is rejected when a field cannot be represented safely.
