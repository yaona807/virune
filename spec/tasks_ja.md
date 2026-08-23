# タスクと構造化並行処理

[英語版](tasks.md)

## `[task.future]` Future
`async`関数を呼び出すと、内部の`Future<T>`が生成されます。`Future`はソースコード上で型名として直接指定できません。`await`は`async`コンテキスト内でのみ使用できます。

## `[task.scope]` 構造化されたライフタイム
子タスクは、それを作成したスコープより長く生存できません。Virune 1.0には切り離されたタスク（detached task）はありません。キャンセルは`AbortSignal`を使う協調方式です。シグナルを無視するJavaScript処理を強制停止することはできません。

## `[task.parallel]` 並行実行
`parallel`はすべてのエントリを開始します。いずれかがrejectすると兄弟タスクへキャンセルを通知し、すべての子タスクの状態が確定するまで待ちます。その後、ソースコード上で最も左にあるreject理由を報告します。成功した場合は、ソースコード上のフィールド順を維持した`record`を返します。

## `[task.parallel-try]` Resultの並行実行
`parallel try`は共通のエラー型を要求します。最初の`Err`が発生すると兄弟タスクへキャンセルを通知し、すべての子タスクの状態が確定するまで待ちます。その後、ソースコード上で最も左にある`Err`を返します。JavaScript側のrejectionや`panic`は、自動的に`Err`へ変換しません。

## `[task.race]` Race操作
`Task.race`は、最初に状態が確定した処理について、成功時はその値を返し、失敗時はその理由でrejectします。`Task.firstOk`は最初に成功した値を返し、すべての処理がrejectした場合は集約された失敗でrejectします。残りの処理にはキャンセルを通知し、すべての状態が確定するまで待ちます。

## `[task.timeout]` 時間とretry
タイムアウトと再試行の待機時間は、有限の0以上の値で、ホストのタイマーが扱える範囲内でなければなりません。タイムアウトは`Result`を返すAPIから`TaskTimeoutError`を返します。再試行では試行番号を維持し、待機に入る前にバックオフを検証します。

## `[task.await-propagate-precedence]` awaitとResult伝播
`await operation()?`は`(await operation())?`と同じ意味です。後置の伝播演算子は内部の`Future`ではなく、非同期処理の完了結果へ適用します。フォーマッターは、曖昧さがない場合に括弧なしの形式を出力します。
