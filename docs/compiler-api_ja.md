# Compiler APIの安定性

[English](compiler-api.md) | [日本語](compiler-api_ja.md)

`@virune/compiler`は、意図的に小さくしたstable APIだけをroot entry pointから公開します。Virune 1.0.0以降、このentry pointをSemantic Versioningの対象とします。

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

stable APIが返すものは、source file、diagnostic、生成JavaScript、project build結果です。Compiler内部のAST、HIR、MIR、symbol table、type arena、binding table、lowering phase、reference evaluatorは公開しません。

公開symbolの正本は`packages/compiler/api/stable-api.snapshot.json`で管理し、`npm run api:check`で差分を検出します。

## Experimental entry point

```ts
import { lex, type ModuleNode } from '@virune/compiler/experimental';
```

experimental entry pointはformatterやtooling開発向けで、stable互換性保証の対象外です。任意のreleaseで変更される可能性があるため、利用側は独自adapterの内側へ隔離してください。

## Internal module

`.`と`./experimental`以外のpackage subpathはexportしません。`dist/src`内のfileを直接importする方法は非対応で、package export mapによって意図的に遮断します。
