# JavaScript相互運用の検証用corpus

Viruneの3段階のJavaScript相互運用を検証するため、代表的なnpmパッケージのAPIを、バージョンを固定して管理しています。

- Tier 1：型宣言から安全に直接利用できるAPI
- Tier 2：コンパイル済みのTypeScriptアダプターを介して利用するAPI
- Tier 3：型情報がないAPIや動的なAPI向けの、検証を省略する危険な利用方法（unsafe）

検証対象には、ESM、型定義を別の`@types`パッケージで提供するCommonJS、ジェネリクスのオーバーロード、外部オブジェクトのハンドル、Promise、条件型、コールバックを多用するAPIが含まれます。
