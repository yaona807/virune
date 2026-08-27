# Tasks and Structured Concurrency

[日本語版](tasks_ja.md)

## `[task.future]` Async context
`await` is valid only in an async context.

## `[task.scope]` Structured lifetime
Child tasks cannot outlive the scope that created them. Detached tasks are not part of Virune 1.0. Cancellation is cooperative and uses `AbortSignal`; non-cooperating JavaScript operations cannot be forcibly stopped.

## `[task.parallel]` Parallel execution
`parallel` starts all entries, cancels siblings when an entry rejects, waits until all children settle, and reports the leftmost rejection by source order. On success, it returns a record preserving source field order.

## `[task.parallel-try]` Parallel Result execution
`parallel try` requires a common error type. The first `Err` triggers sibling cancellation, all children are settled, and the leftmost source `Err` is returned. A JavaScript rejection or panic is not converted to `Err` automatically.

## `[task.race]` First-completion operations

### `Task.race`
`Task.race` uses the result of the first operation to settle. If that operation fulfills, it returns the value; if it rejects, the task rejects with that reason.

### `Task.firstOk`
`Task.firstOk` returns the first fulfilled value. If every operation rejects, it rejects with the aggregate failure.

For both `Task.race` and `Task.firstOk`, operations whose results are not selected receive cancellation, and all operations are awaited to settlement.

## `[task.timeout]` Time and retry
Timeouts and retry delays must be finite non-negative values in the host timer range. Timeout returns `TaskTimeoutError` through its Result API. Retry preserves source attempt numbering and validates backoff before sleeping.

## `[task.await-propagate-precedence]` Await and Result propagation
`await operation()?` is equivalent to `(await operation())?`. The postfix propagation operator applies to the completed async result, not to the internal Future.
