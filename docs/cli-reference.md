# Virune CLI Reference

[English](cli-reference.md) | [日本語](cli-reference_ja.md)

The repository CLI is available after `npm run build`:

```bash
npm run virune -- <command>
```

After installing the published package, the equivalent command is `virune <command>`.

## Global behavior

- Success exits with status `0`.
- User input, compilation, entry-point, test, and formatting failures exit with status `1`.
- Invalid command usage exits with status `2`.
- Diagnostics are written in a stable compiler format with source locations.
- Generated programs use Source Maps when enabled in `virune.json`.

## `virune init`

```text
virune init [path]
```

Creates a new project containing `virune.json` and `src/main.virune`.

```bash
npm run virune -- init playground/hello
```

## `virune check`

```text
virune check [path] [--diagnostic-format=json]
```

Parses, binds, and type-checks a project without emitting JavaScript.

```bash
npm run virune -- check playground/hello
npm run virune -- check playground/hello --diagnostic-format=json
```

The JSON mode is intended for editor and automation integrations.

## `virune build`

```text
virune build [path]
```

Checks the project and emits ES2022 ESM into the configured `outDir`.

```bash
npm run virune -- build playground/hello
```

## `virune run`

```text
virune run [path] [-- program arguments...]
```

Builds the project, validates the executable `main` contract, and runs the generated entry module.

```bash
npm run virune -- run playground/hello
npm run virune -- run playground/hello -- Alice Bob
```

The optional `--` separator is removed before arguments are passed to `main(args: List<String>)`.

Accepted entry signatures are documented in [`../spec/entry-point.md`](../spec/entry-point.md).

## `virune test`

```text
virune test [path]
```

Builds the project and runs emitted Virune test declarations with the Node.js test runner.

```bash
npm run virune -- test playground/hello
```

A project with no tests succeeds and reports that no Virune tests were found.

## `virune fmt`

```text
virune fmt [--check] [path...]
```

Formats `.virune` files recursively.

```bash
npm run virune -- fmt playground/hello
npm run virune -- fmt --check playground/hello
```

`--check` does not write files and fails when canonical formatting differs.

## `virune clean`

```text
virune clean [path]
```

Removes the configured output directory.

```bash
npm run virune -- clean playground/hello
```

## `virune bind`

```text
virune bind <package-or-d.ts> [--out path] [--module specifier]
```

Generates conservative Virune FFI declarations from a TypeScript declaration file or installed package.

```bash
npm run virune -- bind example-package \
  --out src/ffi/example.virune

npm run virune -- bind ./types/example.d.ts \
  --module example-package \
  --out src/ffi/example.virune
```

Unsupported or unsafe TypeScript types are emitted as `Unknown` with diagnostics. Generated bindings remain reviewable source and should not be treated as automatically trusted.

## `virune interop`

```text
virune interop check [path]
virune interop build [path]
virune interop init <module> [--out path]
```

Validates the Interop ABI of `*.interop.ts` adapters. Build emits type-checked ESM and ABI metadata; init creates an adapter template for a complex TypeScript API.

## `virune api`

```text
virune api [path] [--out path] [--check]
```

Writes a deterministic snapshot of a project's public Virune API or compares the current API with an existing snapshot.

```bash
npm run virune -- api . --out api/virune.api
npm run virune -- api . --out api/virune.api --check
```

## `virune explain`

```text
virune explain <diagnostic-code>
```

Prints an explanation for a stable diagnostic code.

```bash
npm run virune -- explain L4010
```

## `virune version`

```text
virune version
virune --version
virune -v
```

Prints the CLI version.

## Repository maintenance commands

These commands are specific to the Virune source repository:

| Command | Purpose |
|---|---|
| `npm run bootstrap` | Install dependencies from the public npm registry using the lockfile |
| `npm run build` | Build all TypeScript workspaces |
| `npm run example` | Build and run the root example |
| `npm test` | Run unit and integration tests |
| `npm run test:conformance` | Run exact language conformance fixtures |
| `npm run fmt:check` | Check bundled examples with the Virune formatter |
| `npm run spec:check` | Verify normative rule mappings and grammar consistency |
| `npm run verify` | Run the complete repository verification gate |
| `npm run pack:virune` | Build local npm package tarballs |
