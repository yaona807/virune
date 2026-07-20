# Taskと構造化並行処理

[English](tasks.md) | [日本語](tasks_ja.md)

## `[task.future]` Future
async functionを呼び出すと内部`Future<T>`を生成します。Futureはソース上で直接型名として指定できません。`await`はasync context内だけで有効です。

## `[task.scope]` 構造化された寿命
子taskは作成したscopeより長く生存できません。Virune 1.0にdetached taskはありません。キャンセルは`AbortSignal`を使う協調方式で、signalを無視するJavaScript処理を強制停止できません。

## `[task.parallel]` 並行実行
`parallel`は全entryを開始し、1つがrejectした場合は兄弟をcancelし、全子taskのsettleを待ち、source orderで最も左のrejectionを報告します。成功時はsource field orderを維持するrecordを返します。

## `[task.parallel-try]` Resultの並行実行
`parallel try`は共通error型を要求します。最初の`Err`で兄弟へcancelを通知し、全子taskをsettleし、source orderで最も左の`Err`を返します。JavaScript rejectionやpanicを自動的に`Err`へ変換しません。

## `[task.race]` Race操作
`Task.race`は最初にsettleした結果を返すかrejectします。`Task.firstOk`は最初のfulfillmentを返し、すべてrejectした場合はaggregate failureになります。loserへcancelを通知し、settleまで待機します。

## `[task.timeout]` 時間とretry
Timeoutとretry delayは有限・非負でhost timer範囲内でなければなりません。TimeoutはResult APIから`TaskTimeoutError`を返します。Retryはsource attempt numberを維持し、sleep前にbackoffを検証します。

## `[task.await-propagate-precedence]` awaitとResult伝播
`await operation()?`は`(await operation())?`と同じ意味です。postfixの伝播operatorは内部Futureではなく、非同期処理の完了結果へ適用します。Formatterは曖昧さがない場合に括弧なしの形式を出力します。
