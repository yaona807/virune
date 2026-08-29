# Evaluation and Control Flow

[日本語版](evaluation_ja.md)

## `[eval.order]` Evaluation order
Function callee, arguments, record fields, contextual aggregate entries, collection elements, and binary operands are evaluated left-to-right. For indexed access, the receiver is evaluated before the index expression. For member assignment, the receiver is evaluated before the assigned value. For indexed assignment, the receiver, index expression, and assigned value are evaluated in that order. `&&` and `||` short-circuit. Match arms are tested top-to-bottom; only the selected guard and expression execute.

## `[eval.contextual-source-forms]` Context-directed aggregate, index, and assignment forms
The bare aggregate form `{ name: value }`, postfix index form `receiver[index]`, and member/index assignment forms are source forms whose legality is determined by the statically proven operation for their context. Their syntax alone does not make a value aggregate-compatible, indexable, or writable.

A bare aggregate is distinct from nominal native record construction such as `Config { timeout: 3000 }`. It does not structurally project a native record or collection into another representation. If no supported contextual aggregate operation is proven, compilation fails.

Indexed access does not introduce universal indexing for native values. Member or index assignment does not change native record or `List` immutability. An assignment target must be a mutable name, member target, or index target, and the corresponding writable operation must be statically proven. Unknown, unresolved, or ambiguous operation capability is a compile error rather than permission to perform the operation.

These forms preserve the evaluation order described by `[eval.order]`. A semantic provider that accepts a form must preserve that order and the observable execution semantics of the proven operation.

## `[eval.integer]` Integer operations
`Int` arithmetic checks the JavaScript safe-integer range. Overflow, division by zero, and remainder by zero panic. Integer division truncates toward zero.

## `[eval.match]` Pattern matching
`match` over closed types must be exhaustive. Guards do not contribute to exhaustiveness. Unreachable arms are rejected. OR-pattern alternatives cannot bind names in Virune 1.0.

## `[eval.return]` Function completion
A non-`Unit` function returns a value on every reachable path. `Never` marks expressions that do not complete normally. Unreachable statements are diagnosed.

## `[eval.defer]` Resource cleanup
`defer expression` registers cleanup in the current function or lambda scope. Cleanups run once in last-in-first-out order after normal return, `?` propagation, or panic. If cleanup fails, `ResourceCleanupError` preserves the primary failure and all cleanup failures in execution order.

## `[eval.panic]` Panic
Panic represents a violated invariant or unrecoverable runtime failure. Normal Virune code does not catch panic. Task, test, CLI, and JavaScript export boundaries may translate or report it.

## `[eval.loop-control]` Loop control
`break` exits the nearest enclosing `for` or `while`; `continue` starts its next iteration. Both are compile errors outside a loop and cannot cross a function or lambda boundary. Deferred cleanup remains scoped to function or lambda completion rather than each loop iteration.

## `[eval.unit-implicit-return]` Unit fallthrough
A function or lambda whose declared result is `Unit` may reach the end of its body without an explicit `return Unit`. Completion produces `Unit`. Explicit `return Unit` remains valid. Non-`Unit` functions retain the existing all-path return requirement.
