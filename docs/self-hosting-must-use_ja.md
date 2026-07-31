# Self-host local must-use analysis

[English](self-hosting-must-use.md)

Self-host Checkerは、expression inferenceとcontrol-flow checkingへ接続する前段階として、local must-use型と明示的な値の消費方法を分類します。

## 対応するmust-use source

隔離されたJSON contractはflat frontend ASTとcanonical semantic arenaを組み合わせ、次を分類します。

- `@mustUse`が付いたlocal record、enum、newtype
- `Result<T, E>`値
- 上記のいずれかへ再帰的に解決されるtype alias

Declaration handleはaliasを辿る前にcanonical named type IDを維持します。これによりnewtypeの名目的境界を保持し、direct attribute、alias、`Result`を別々のmust-use理由として返せます。

`Future<T>`、foreign snapshot metadata、`Stream`／`FileHandle`／`MutableBytes`などのstandard library resource型は、後続のasync、interop、standard library移行sliceへ分離します。

## Attribute検証

- `@mustUse`はrecord、enum、newtype declarationだけで使用できます。
- 非対応targetは`L2090`です。
- 引数が1件以上ある場合は`L2091`です。
- 正しいtargetに付いたattributeは、引数違反のdiagnosticがあってもmust-use分類自体は維持し、Legacy Checkerのmodelと一致させます。

## 値の消費

Contractはcanonical type handleごとに明示的なdispositionを受け取ります。

- `expression`: 無視されたexpression value
- `bind`
- `return`
- `discard`
- `await`
- `handle`

Must-use値が`expression`の場合は`L2097`です。それ以外の5種類は明示的に消費済みとして扱います。未知のdispositionは有限な`L9001`、未知のtype handleはpanicせず`L2040`になります。

Resultにはcanonical type ID、分類理由、消費判定、annotation付きdeclaration ID、diagnosticを含めます。同一requestは完全に同じserializationを返す必要があります。公開するのは文字列ベースのJSON adapterだけで、parser／semantic／request／result recordはこの段階ではmodule-privateとします。

## 検証

```bash
npm run build
node --test --test-timeout=120000 packages/compiler/dist/test/selfhost-must-use.test.js
```

このsliceではexpression type inference、Production Checker接続を行わず、grammar、stable Compiler API、Runtime ABI、Interop ABI、public standard libraryも変更しません。
