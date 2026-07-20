# Modules and Packages

[English](modules.md) | [日本語](modules_ja.md)

## `[module.file]` File modules
Each `.virune` file is one module. Relative imports include the `.virune` extension and are resolved exactly; directory indexes and extension inference are not performed.

## `[module.visibility]` Visibility
Declarations are private by default. `pub` exposes a declaration from its module. A public signature cannot expose a private nominal type.

## `[module.import]` Imports
Imports are named. `import type` removes the import from generated JavaScript. `pub import` re-exports the imported identity. Default and wildcard namespace imports are not part of 1.0.

## `[module.cycle]` Cycles
Module dependency cycles are rejected, including type-only cycles.

## `[module.package]` npm packages
Package resolution uses `package.json` and an `exports` entry with the `virune` condition for source declarations. Generated JavaScript uses the normal ESM import condition. Platform constraints are checked at compile time.

## `[module.api]` Public API snapshots
`virune api` creates a deterministic public interface snapshot. `virune api --check` rejects drift. Source, runtime ABI, behavior, and formatter compatibility are tracked separately.

## Platform execution

`[platform.browser-runtime]` A project configured with `platform: "browser"` emits browser-loadable ES2022 ESM and may use browser standard-library adapters while Node-only imports are rejected. Release conformance executes emitted modules in an actual Chromium process and verifies Runtime ABI imports, DOM interaction, asynchronous module loading, and binary values.
