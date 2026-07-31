# Self-host昇格ゲート

[English](self-hosting-promotion-gates.md)

ViruneのSelf-hostingは、`.github/self-hosting/promotion-policy-v1.json`に保存されたversioned policyに従い、informational validationからProduction compilerへ段階的に昇格します。

## Fail-closed規則

- 昇格を自動実行しません。
- Pull Request上のinformational stageを除き、すべての段階で明示承認を必須とします。
- Legacy／Self-host間の未説明差分は常に0件でなければなりません。
- 後続stageは証跡を追加できますが、前段階で必須だった証跡を削除できません。
- Blocking stageでは、連続成功回数と観測期間の両方を満たす必要があります。
- Production昇格にはrollback証跡、release再現性、ABI／Compiler API互換性、および完了済みstable release cycleを最低1回必要とします。

数値条件を満たすことはレビュー可能になる条件であり、それだけでCompilerを自動昇格させるものではありません。

## Stage順序

| Stage | Blocking | 最低履歴 | 対象 |
| --- | --- | --- | --- |
| `pr-informational` | いいえ | なし | Pull Requestのsmoke check |
| `nightly-shadow` | いいえ | 明示承認 | Nightly full shadow validation |
| `required-selfhost` | はい | 14日間で14回連続成功 | Self-host関連変更 |
| `required-compiler` | はい | 28日間で28回連続成功 | Compiler変更全体 |
| `production-default` | はい | 30日間で30回連続成功、stable release cycle 1回 | Production compiler選択 |

## 検証

```bash
node scripts/verify-selfhost-promotion-policy.mjs
node --test scripts/verify-selfhost-promotion-policy.test.mjs
```

専用GitHub Actions workflowは、policy、検証器、テストまたは本ドキュメントの変更時に両コマンドを実行します。

このpolicyが定義するのは昇格可能性の判定条件だけです。Stage 1／Stage 2生成、Production compiler切り替え、Legacy compiler削除、既存quality gateの緩和はこの変更に含みません。
