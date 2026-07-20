# Executable Entry Point

[English](entry-point.md) | [日本語](entry-point_ja.md)

This document defines the executable-entry contract used by `virune run`.

## Scope

`[entry.run-only]` The entry-point contract is validated only for `virune run`. Library builds, `virune check`, `virune build`, API snapshots, and modules imported as dependencies do not require a `main` declaration.

`[entry.module]` The configured `entry` file in `virune.json` is the only module searched for the executable entry point.

## Declaration

`[entry.main]` An executable entry module must declare exactly one function named `main`, and that function must be public.

`[entry.non-generic]` `main` must not declare type parameters.

`[entry.parameters]` `main` accepts either no parameters or one parameter whose type is exactly `List<String>`. When present, the list contains program arguments after the project path passed to `virune run`.

`[entry.return]` `main` must return either `Unit` or `Result<Unit, E>` for any well-formed error type `E`.

`[entry.async]` `main` may be synchronous or asynchronous. The CLI awaits the result before deciding the process exit status.

The accepted forms are therefore:

```virune
pub fn main() -> Unit
pub fn main(args: List<String>) -> Unit
pub fn main() -> Result<Unit, E>
pub fn main(args: List<String>) -> Result<Unit, E>
pub async fn main() -> Unit
pub async fn main(args: List<String>) -> Unit
pub async fn main() -> Result<Unit, E>
pub async fn main(args: List<String>) -> Result<Unit, E>
```

The declarations above show signatures; each declaration must have a valid Virune body.

## Exit behavior

`[entry.exit]` Returning `Unit` or `Ok(Unit)` exits with status 0. Returning `Err(error)` writes the error value to standard error and exits with status 1. A panic or rejected asynchronous entry writes a user-facing message to standard error and exits with status 1.

`[entry.diagnostic]` Missing or invalid entry points are user-program errors, not compiler-internal errors. They produce stable diagnostics `L5010` through `L5016`, exit with status 1, and do not print an internal JavaScript stack trace.

## Browser modules

`[entry.browser]` Browser-target builds do not automatically invoke `main`. Browser applications expose functions through `@jsExport` or import the generated ESM from a JavaScript bootstrap module. The `main` contract remains specific to `virune run`.
