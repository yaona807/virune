# Virune feature showcase

[English](README.md) | [日本語](README_ja.md)

This directory is the executable, task-oriented showcase for the public Virune 1.0 surface. It is intentionally split into Node and browser projects so platform constraints remain visible instead of being hidden behind a single configuration.

## What this first landing demonstrates

The Node project composes several language features in one small directory application:

- multi-module named imports;
- `newtype`, `record`, `enum`, `Option`, and `Result` domain modeling;
- explicit `Console` effects at the executable boundary;
- asynchronous work with `await` and `parallel try`;
- deterministic cleanup with `defer`;
- `List`, `Map`, and `Set` collections;
- Virune-native tests discovered from `test.include`.

The browser project uses the public browser target and an `@jsExport` entry that updates the DOM through the standard-library `Dom` boundary.

## Layout

```text
feature-showcase/
├── node/
│   ├── virune.json
│   └── src/
│       ├── domain.virune
│       ├── collections.virune
│       ├── workflow.virune
│       ├── main.virune
│       └── showcase.spec.virune
└── browser/
    ├── virune.json
    └── src/main.virune
```

## Verify from this repository

Build the repository toolchain first, then run:

```bash
npm run virune -- fmt --check examples/feature-showcase/node
npm run virune -- check examples/feature-showcase/node
npm run virune -- test examples/feature-showcase/node
npm run virune -- build examples/feature-showcase/node
npm run virune -- run examples/feature-showcase/node -- Alice Bob

npm run virune -- fmt --check examples/feature-showcase/browser
npm run virune -- check examples/feature-showcase/browser
npm run virune -- build examples/feature-showcase/browser
```

A public API snapshot can be generated without changing compiler semantics:

```bash
npm run virune -- api examples/feature-showcase/node --out /tmp/feature-showcase.api
```

## Scope boundary

This first landing deliberately stays inside `examples/feature-showcase/**`. It does not change the compiler, runtime, JavaScript interop implementation, root package scripts, or CI workflows.

The remaining Issue #78 slices are intentionally separate: a checked-in public API snapshot and representative safe-binding / TypeScript-adapter / isolated-unsafe-FFI examples. Browser execution in an actual browser belongs to the follow-up quality-gate work in Issue #81.
