# Modules and Packages

[日本語版](modules_ja.md)

## `[module.file]` File modules
Each `.virune` file is one module. Relative imports include the `.virune` extension and are resolved exactly; directory indexes and extension inference are not performed.

## `[module.visibility]` Visibility
Declarations are private by default. `internal` exposes a declaration to other modules in the same package or application scope. `pub` exposes a declaration as published public API.

Visibility is ordered as:

```text
private < internal < public
```

A declaration signature cannot expose a nominal type with lower visibility: a `pub` signature may refer only to public nominal types, while an `internal` signature may refer to internal or public nominal types. Private signatures are unrestricted by module visibility.

For the root project, modules in that project share one application/package scope. Modules inside one installed npm package share that concrete package scope. Internal visibility does not cross from an installed dependency into its consumer, and unknown or out-of-scope paths do not acquire internal visibility by inference.

`internal` is a declaration visibility modifier. It does not define an `internal import` or internal re-export form. A runtime JavaScript binding for an internal declaration may be emitted as an ESM export when needed for sibling-module linking; that runtime export does not make the declaration part of the published Virune API.

## `[module.import]` Imports
Imports are named. `import type` removes the import from generated JavaScript. `pub import` re-exports the imported identity. A `pub import` cannot promote an `internal` declaration into published public API.

## `[module.cycle]` Cycles
Module dependency cycles are rejected, including type-only cycles.

## `[module.package]` npm packages
Package resolution uses `package.json` and an `exports` entry with the `virune` condition for source declarations. Generated JavaScript uses the normal ESM import condition. Platform constraints are checked at compile time.

## `[module.javascript-target]` JavaScript target
The JavaScript output target for Virune 1.0 projects is ES2022, selected by `target: "es2022"`; other target values are rejected.

## Platform execution

`[platform.browser-runtime]` A project configured with `platform: "browser"` emits browser-loadable ES2022 ESM and may use browser standard-library adapters while Node-only imports are rejected.