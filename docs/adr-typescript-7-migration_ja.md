# ADR: TypeScript 7移行

[English](adr-typescript-7-migration.md)

- Status: 実装方針として承認
- Decision date: 2026-07-25
- Related issue: [#32](https://github.com/yaona807/virune/issues/32)
- 直接更新が失敗したPR: [#26](https://github.com/yaona807/virune/pull/26)

## Context

ViruneはTypeScriptを異なる2つの役割で利用しています。

1. `tsc -b`で実行するrepository build compiler
2. JavaScript interopとdeclaration bindingが使用する同期Compiler API

TypeScript 7はnative compiler／language serverであり、7.0は従来のJavaScript Compiler APIを公開しません。TypeScript teamは、このAPIを必要とするtool向けに`@typescript/typescript6`を公開し、native TypeScript 7 compilerとの併用方法を案内しています。

PR #26ではroot dependencyをTypeScript 6.0.3から7.0.2へ直接更新し、build系の全Workflowが失敗しました。この更新は`typescript`としてimportするpackageを置換したため、API consumerが必要とするJavaScript APIの喪失とbuild toolchain変更が同時に発生しました。

References:

- [Announcing TypeScript 7.0](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/)
- [TypeScript Compiler API](https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API)

## Compiler API inventoryと境界

Canonical inventoryは次のcommandで生成します。

```bash
npm run typescript:boundary:check
```

Production API consumerは次のとおりです。

- `packages/js-interop/`: runtime provider、adapter、制御されたtestを含みます。Providerは`Program`、`TypeChecker`、`LanguageService`、module resolution、diagnostic、AST predicateを使用します。
- `packages/cli/src/bind.ts`: TypeScript declarationをparseし、対応するfunction、interface、alias、variableをVirune bindingへ変換します。

Repository toolingのconsumerは次の2つへ限定します。

- `scripts/run-binding-corpus.mjs`: corpus証跡へTypeScript versionを記録します。
- `scripts/verify-public-abi.mjs`: declaration outputを解析しながらpublic ABI snapshotを検証します。

Root、CLI、JavaScript interopのmanifestが現在TypeScriptを宣言しています。Compiler、runtime、formatter、standard library、language server、VS Code、その他のtooling sourceはCompiler API importまたはdependencyを追加できません。Machine-readable policyは列挙したroot、path、manifest以外の変更を拒否します。

## Decision

Build compilerと組み込みCompiler APIを別packageとして管理します。

Root移行では次の厳密なdependency構成を使用します。

```json
{
  "devDependencies": {
    "@typescript/native": "npm:typescript@7.0.2",
    "typescript": "npm:@typescript/typescript6@6.0.3"
  }
}
```

APIを使用する2つのworkspaceは同じexact compatibility aliasを使用します。

```json
{
  "dependencies": {
    "typescript": "npm:@typescript/typescript6@6.0.3"
  }
}
```

`@typescript/native`はrepository build scriptが使用するnative `tsc` executableを提供します。`typescript` import specifierはinterop provider、CLI binder、許可tooling用のTypeScript 6 compatibility packageへ解決し続けます。Workspace dependencyを明示することでruntime behaviorがnpm hoistingへ依存しないようにします。

Version rangeは使用せずexact versionにします。

- native compilerは全CIとstable release証跡を伴うreview済みdependency PRで更新する
- compatibility APIは独立して更新し、binding corpusとABI reviewを必須とする
- 2つのversionは同じrelease cadenceで更新する必要がない
- TypeScript 7.1以降のprogrammatic APIをinterop providerとbinding generatorの両contractに対して評価するまで、compatibility APIを置換しない

## Prototype gate

Prototypeはcommit済みdependency graphを変更せずに実行します。

```bash
npm run prototype:typescript7
```

Exact TypeScript 7 compilerを隔離した一時tool directoryへinstallし、次を検証します。

1. TypeScript 6 Compiler API inventory、境界、version
2. TypeScript 6によるforced clean build
3. TypeScript 7によるforced clean build
4. `.tsbuildinfo`を除くJavaScript、declaration、mapのbit-for-bit一致
5. emitted outputを変更しないTypeScript 7 incremental build
6. `@virune/js-interop` testとbinding corpus
7. language server／VS Code extension test
8. VSIX package生成

証跡は`.cache/typescript-7-prototype/`へJSON、Markdown、command別logとして保存します。専用GitHub Actions workflowは成功時・失敗時の両方で証跡をuploadします。

## Migration sequence

1. Prototype gateを維持する間は現行TypeScript 6 dependency graphを保持する。
2. Linux上のprototype outputとdiagnostic parityをreviewする。
3. Native compiler aliasとcompatibility aliasをroot、CLI、JavaScript interop manifestへ適用し、lockfileを更新する実装PRを作成する。
4. 通常OS matrix、browser conformance、performance、VSIX smoke、binding corpus、release dry run、reproducible release gateを実行する。
5. Compiler output、diagnostic、clean／incremental timing、package size、startup behaviorをreviewする。
6. 既存release gateとTypeScript 7 prototypeがすべて成功した場合だけmergeする。
7. Commit済みtoolchainがTypeScript 7を使用した後はprototype専用installを削除し、boundary policyとparity checkは維持する。

## Rollback

Rollbackでは`@typescript/native`を削除し、root、CLI、JavaScript interopの`typescript`指定をexact `6.0.3`へ戻し、lockfileを再生成してstable release gateを実行します。Compiler API import境界はrollback中も変更しません。

## Consequences

- 同期interop providerとbinding generatorを書き直さずnative compilerを利用できる。
- Compiler build性能とCompiler API互換性を独立して更新できる。
- 一時的に2つのTypeScript実装を保持する。
- Native platform packageとcompatibility APIが共存するため、package sizeとinstall時間が増加する可能性がある。
- Boundary policyによりreview済みproduction／tooling consumer外からlegacy APIへ偶発的に依存することを防止できる。
