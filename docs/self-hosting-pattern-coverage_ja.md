# Self-host closed pattern coverage

[English](self-hosting-pattern-coverage.md)

Self-host Checkerは、pattern bindingと式型検査へ接続する前段階として、exhaustivenessを決定的なpattern-space tableで表現します。

## 対応するspace

隔離されたJSON contractはsemantic source moduleと明示的なmatch arm descriptorを受け取り、canonical semantic arenaを通してtype aliasを解決します。対象は次のとおりです。

- `Bool`: `true`、`false`
- `Option<T>`: `Some`、`None`
- `Result<T, E>`: `Ok`、`Err`
- generic instantiationを含むlocal enum
- unguarded wildcardを必須とするopen spaceの`Int`と`String`

Case IDは連番で、言語上のcanonical順を維持します。Local enumのcaseはdeclaration member順です。

## Coverage規則

- unguarded wildcardは対応するすべてのpattern spaceを閉じます。
- guarded armはexhaustivenessへ寄与しません。
- duplicate unguarded patternは`L3002`です。
- unguarded wildcardより後のarmはunreachableとして`L3002`です。
- 不完全な`Bool` coverageは`L3003`です。
- enum、`Option`、`Result`の不足caseはcanonical順の`L3004`です。
- unguarded wildcardがない`Int`／`String`は`L3005`です。
- unknown target／caseやmalformed requestはpanicせずdiagnosticを返します。

Resultにはcanonical case、arm reachability、covered case ID、missing case ID／name、最終的なexhaustiveness判定を含めます。同一requestは完全に同じJSONを返す必要があります。公開するのは文字列ベースのJSON adapterだけで、request／result／semantic transport recordはmodule-privateとします。

## 検証

```bash
npm run build
node --test --test-timeout=120000 packages/compiler/dist/test/selfhost-pattern-coverage.test.js
```

このsliceではpattern payloadの型検査、pattern binding、arm result type比較、multi-module enum resolution、Production Checker接続を行いません。Grammar、stable Compiler API、Runtime ABI、Interop ABI、public standard libraryも変更しません。
