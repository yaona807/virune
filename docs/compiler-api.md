# Compiler API stability

[English](compiler-api.md) | [日本語](compiler-api_ja.md)

`@virune/compiler` exposes a deliberately small stable API. Semantic Versioning applies to this root entry point starting with Virune 1.0.0.

## Stable entry point

```ts
import {
	buildProject,
	compileSource,
	formatDiagnostics,
	loadConfig,
	type CompileOptions,
	type CompileResult,
	type Diagnostic,
	type SourceFile,
} from '@virune/compiler';
```

The stable API returns source files, diagnostics, emitted JavaScript, and project build results. It does not expose compiler-owned AST, HIR, MIR, symbol tables, type arenas, binding tables, lowering phases, or the reference evaluator.

The exact exported symbol set is stored in `packages/compiler/api/stable-api.snapshot.json` and checked by `npm run api:check`.

## Experimental entry point

```ts
import { lex, type ModuleNode } from '@virune/compiler/experimental';
```

The experimental entry point supports formatter and tooling development. It is explicitly excluded from the stable compatibility guarantee and may change in any release. Consumers must isolate it behind their own adapter.

## Internal modules

Package subpaths other than `.` and `./experimental` are not exported. Importing files from `dist/src` is unsupported and intentionally blocked by the package export map.
