# セルフホスト昇格ポリシー

[English](self-hosting-promotion-policy.md) | [日本語](self-hosting-promotion-policy_ja.md)

`selfhost/promotion-policy.v1.json`は、セルフホスト検証を非blocking観測からrequired gateへ段階的に昇格し、最終的に手動承認されたproduction default候補とするためのmachine-readable正本です。

## 安全不変条件

Policy v1はfail-closedで、次を固定します。

- production compiler defaultは`legacy`のままにする
- fixed Seedを自動更新しない
- policy stageからproductionを自動切替しない
- Legacy compilerを最低1 release cycle保持する
- 各昇格は直前stageの完了を必要とする
- compatibility、bootstrap、runtime、ABI、performance、clean bootstrap、rollbackの必要信号をすべて成功させる
- required gateとproduction stageではNightly成功履歴と観測日数の下限を満たす
- internal opt-inとproduction-default候補化には明示的な手動承認を必要とする

## Stage

1. `non_blocking_pr`: Pull Request上でformat、build、unit、differential smokeを非blocking観測する。
2. `nightly_shadow`: Nightlyでfull shadow evidenceを非blocking収集する。
3. `required_selfhost`: 7日以上かつ14回連続成功後、self-host関連pathだけrequired化できる。
4. `required_compiler`: 14日以上かつ30回連続成功後、compiler pathへrequired範囲を拡張できる。
5. `internal_opt_in`: production defaultを変えず、手動承認された内部opt-in経路を有効化できる。
6. `production_default`: 30日以上かつ60回連続成功し、全信号が成功した場合だけ手動切替候補になる。

Eligibleは実行命令ではありません。Evaluatorは常に`automatic: false`を返し、外部toolはeligible判定を、別のレビュー済み切替操作を申請できる状態として扱います。

## Evidence

Evaluatorは次の明示的evidenceを受け取ります。

- 完了済みpromotion target
- 名前付きboolean signal
- Nightly連続成功回数
- 観測日数
- 手動承認状態

不足signalは失敗として扱います。未知または不正なpolicy fieldは拒否します。Stageとsignalの配列はsort済みかつ一意である必要があり、JSON policyの決定性とレビュー可能性を維持します。

## 現在の境界

このpolicyはworkflow、branch protection、compiler選択、production default、fixed Seed、stable Compiler API、Runtime ABI、Interop ABI、grammar、公開standard libraryを変更しません。
