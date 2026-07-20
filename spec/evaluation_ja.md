# 評価と制御フロー

[English](evaluation.md) | [日本語](evaluation_ja.md)

## `[eval.order]` 評価順
関数callee、argument、record field、collection element、binary operandは左から右へ評価します。`&&`と`||`はshort-circuitします。match armは上から順に検査し、選択されたguardと式だけを実行します。

## `[eval.integer]` 整数演算
`Int`演算はJavaScript safe integer範囲を検査します。overflow、ゼロ除算、ゼロ剰余はpanicです。整数除算は0方向へ切り捨てます。

## `[eval.match]` Pattern match
閉じた型に対する`match`は網羅的でなければなりません。guardは網羅性へ寄与しません。到達不能armは拒否します。Virune 1.0のOR pattern alternativeは名前をbindできません。必要な場合は外側のarmまたはnested matchを使用します。

## `[eval.return]` 関数の完了
`Unit`以外を返す関数は、すべての到達可能経路で値を返します。`Never`は正常完了しない式を表します。到達不能文は診断します。

## `[eval.defer]` Resource cleanup
`defer expression`は現在のfunctionまたはlambda scopeへcleanupを登録します。通常return、`?`伝播、panic後にLIFOで1回実行します。cleanupが失敗した場合、`ResourceCleanupError`がprimary failureとすべてのcleanup failureを実行順で保持します。

## `[eval.panic]` Panic
Panicは不変条件違反または回復不能なRuntime失敗です。通常のViruneコードはpanicをcatchしません。task、test、CLI、JavaScript export境界は報告または変換できます。

## `[eval.reference]` 参照評価器
リポジトリには純粋コア用の小さな評価器があります。これは検証oracleであり、本番Runtimeではありません。未対応のeffectful構文は拒否します。

## `[eval.loop-control]` ループ制御
`break`は最も近い`for`／`while`を終了し、`continue`は次のiterationへ進みます。loop外ではコンパイルエラーで、function／lambda境界を越えられません。defer cleanupはiterationごとではなくfunction／lambda完了時に実行します。

## `[eval.unit-implicit-return]` Unitの暗黙return
戻り値型が`Unit`のfunctionまたはlambdaは、明示的な`return Unit`なしでbody末尾へ到達できます。その完了値は`Unit`です。明示的な`return Unit`も引き続き有効です。非`Unit` functionでは、従来どおりすべての到達pathにreturnを要求します。
