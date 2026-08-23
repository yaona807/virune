# 評価と制御フロー

[英語版](evaluation.md)

## `[eval.order]` 評価順
関数呼び出し先（callee）、引数、recordのフィールド、コレクションの要素、二項演算子のオペランドは左から右へ評価します。`&&`と`||`は短絡評価します。`match`のarmは上から順に検査し、選択されたguardと式だけを実行します。

## `[eval.integer]` 整数演算
`Int`の演算では、JavaScriptで安全に表現できる整数の範囲を検査します。overflow、ゼロ除算、ゼロ剰余はpanicになります。整数除算は0の方向へ切り捨てます。

## `[eval.match]` パターンマッチ
閉じた型に対する`match`は網羅的でなければなりません。guardは網羅性の判定には使いません。到達不能なarmは拒否します。Virune 1.0では、ORパターンの各選択肢で名前をbindできません。bindが必要な場合は、外側のarmまたは入れ子の`match`を使います。

## `[eval.return]` 関数の完了
`Unit`以外を返す関数は、到達可能なすべての経路で値を返さなければなりません。`Never`は正常に完了しない式を表します。到達不能な文は診断します。

## `[eval.defer]` リソースの後始末
`defer expression`は、現在の関数またはlambdaのスコープへ後始末を登録します。後始末は通常の`return`、`?`による伝播、panicの後に、後入れ先出し（LIFO）の順序で1回実行します。後始末に失敗した場合、`ResourceCleanupError`は元の失敗とすべての後始末中の失敗を実行順に保持します。

## `[eval.panic]` Panic
Panicは、不変条件への違反または回復不能なRuntimeの失敗を表します。通常のViruneコードはpanicをcatchしません。task、test、CLI、JavaScript exportの境界では、panicを別の形へ変換したり報告したりできます。

## `[eval.reference]` 参照評価器
リポジトリには、純粋なコア部分だけを扱う小さな評価器があります。これは検証の基準として使うもので、本番Runtimeではありません。この評価器が対応していないeffect付き構文は拒否します。

## `[eval.loop-control]` ループ制御
`break`は最も近い`for`または`while`を終了し、`continue`はそのループの次のiterationへ進みます。どちらもループ外ではコンパイルエラーになり、関数またはlambdaの境界を越えることはできません。`defer`で登録した後始末はiterationごとではなく、関数またはlambdaが完了するときに実行します。

## `[eval.unit-implicit-return]` Unitの暗黙return
戻り値型が`Unit`の関数またはlambdaは、明示的な`return Unit`を書かずにbodyの末尾へ到達できます。その場合の完了値は`Unit`です。明示的な`return Unit`も引き続き有効です。`Unit`以外を返す関数では、従来どおり到達可能なすべての経路で値を返す必要があります。
