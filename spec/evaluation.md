# Evaluation and Control Flow

[English](evaluation.md) | [日本語](evaluation_ja.md)

## `[eval.order]` Evaluation order
Function callee, arguments, record fields, collection elements, and binary operands are evaluated left-to-right. `&&` and `||` short-circuit. Match arms are tested top-to-bottom; only the selected guard and expression execute.

## `[eval.integer]` Integer operations
`Int` arithmetic checks the JavaScript safe-integer range. Overflow, division by zero, and remainder by zero panic. Integer division truncates toward zero.

## `[eval.match]` Pattern matching
`match` over closed types must be exhaustive. Guards do not contribute to exhaustiveness. Unreachable arms are rejected. OR-pattern alternatives cannot bind names in Virune 1.0; use a surrounding match arm or nested match when bindings are required.

## `[eval.return]` Function completion
A non-`Unit` function returns a value on every reachable path. `Never` marks expressions that do not complete normally. Unreachable statements are diagnosed.

## `[eval.defer]` Resource cleanup
`defer expression` registers cleanup in the current function or lambda scope. Cleanups run once in last-in-first-out order after normal return, `?` propagation, or panic. If cleanup fails, `ResourceCleanupError` preserves the primary failure and all cleanup failures in execution order.

## `[eval.panic]` Panic
Panic represents a violated invariant or unrecoverable runtime failure. Normal Virune code does not catch panic. Task, test, CLI, and JavaScript export boundaries may translate or report it.

## `[eval.reference]` Reference evaluator
The repository includes a deliberately small evaluator for the pure core. It is a verification oracle, not the production runtime. Unsupported effectful constructs are rejected by that evaluator.

## `[eval.loop-control]` Loop control
`break` exits the nearest enclosing `for` or `while`; `continue` starts its next iteration. Both are compile errors outside a loop and cannot cross a function or lambda boundary. Deferred cleanup remains scoped to function or lambda completion rather than each loop iteration.

## `[eval.unit-implicit-return]` Unit fallthrough
A function or lambda whose declared result is `Unit` may reach the end of its body without an explicit `return Unit`. Completion produces `Unit`. Explicit `return Unit` remains valid. Non-`Unit` functions retain the existing all-path return requirement.
