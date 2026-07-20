# JavaScript Interop corpus

ViruneのThree-Tier JavaScript相互運用を検証するため、代表的なnpm APIを固定versionで管理します。

- Tier 1：保守的な直接Facade
- Tier 2：コンパイル済みTypeScript Adapter
- Tier 3：型情報のない動的API向けunsafe escape hatch

ESM、`@types`分離CommonJS、generic overload、foreign object handle、Promise、Conditional型、callback中心APIを含みます。
