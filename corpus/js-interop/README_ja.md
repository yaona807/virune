# JavaScript相互運用の検証データ

Viruneの3段階のJavaScript相互運用を検証するため、npmパッケージから代表的なAPIを選び、バージョンを固定して検証しています。

- Tier 1：対応範囲を絞って直接利用するAPI（Direct Facade）
- Tier 2：コンパイル済みのTypeScriptアダプターを介して利用するAPI
- Tier 3：型情報がないAPIや動的なAPI向けに、通常の型検査を省略する経路（unsafe）

検証対象には、ESM、型定義を別の`@types`パッケージで提供するCommonJS、ジェネリクスのオーバーロード、外部オブジェクトのハンドル、Promise、条件型、コールバックを多用するAPIが含まれます。
