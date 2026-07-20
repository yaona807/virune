# Tasks and Structured Concurrency

[English](tasks.md) | [日本語](tasks_ja.md)

## `[task.future]` Futures
Calling an async function creates an internal `Future<T>`. `Future` is not directly nameable in source. `await` is valid only in an async context.

## `[task.scope]` Structured lifetime
Child tasks cannot outlive the scope that created them. Detached tasks are not part of Virune 1.0. Cancellation is cooperative and uses `AbortSignal`; non-cooperating JavaScript operations cannot be forcibly stopped.

## `[task.parallel]` Parallel execution
`parallel` starts all entries, cancels siblings when an entry rejects, waits until all children settle, and reports the leftmost rejection by source order. On success, it returns a record preserving source field order.

## `[task.parallel-try]` Parallel Result execution
`parallel try` requires a common error type. The first `Err` triggers sibling cancellation, all children are settled, and the leftmost source `Err` is returned. A JavaScript rejection or panic is not converted to `Err` automatically.

## `[task.race]` Race operations
`Task.race` returns or rejects with the first settlement. `Task.firstOk` returns the first fulfillment and rejects with aggregate failure if all operations reject. Losers receive cancellation and are awaited to settlement.

## `[task.timeout]` Time and retry
Timeouts and retry delays must be finite non-negative values in the host timer range. Timeout returns `TaskTimeoutError` through its Result API. Retry preserves source attempt numbering and validates backoff before sleeping.

## `[task.await-propagate-precedence]` Await and Result propagation
`await operation()?` is equivalent to `(await operation())?`. The postfix propagation operator applies to the completed async result, not to the internal Future. The formatter emits the parenthesis-free form when it is unambiguous.
