# Self-host control-flow termination

[日本語](self-hosting-control-flow_ja.md)

The control-flow slice reproduces the bounded Legacy termination analysis over a deterministic flat flow-node arena. Parent nodes reference only later node IDs, making the arena acyclic by construction.

## Termination rules

- `return`, `break`, and `continue` terminate the current path.
- Expression and discard nodes terminate when their inferred type is `Never`.
- An `if` terminates only when both its then and else branches terminate.
- A `while true` terminates when its body terminates.
- A false／dynamic while and every for loop remain non-terminating guarantees.
- A block marks each statement after the first terminating statement as unreachable without traversing that unreachable subtree.

A non-`Unit` function that does not terminate on every path produces `L3001`. Every unreachable statement produces `L3006`. Duplicate function entries produce `L1001`; malformed node kinds, child layouts, ordering, references, names, and bodies produce `L9001`.

The JSON result contains contiguous node and function IDs, all-path termination decisions, unreachable node IDs, and deterministic diagnostics.

```bash
npm run build
node --test --test-timeout=120000 packages/compiler/dist/test/selfhost-control-flow.test.js
```

This slice does not infer expression or return types, perform deeper loop escape analysis, or implement try／catch, defer, async／await, or structured-concurrency semantics. It does not connect the self-host checker to the Production Compiler or change the grammar, stable Compiler API, Runtime ABI, Interop ABI, or public standard library.
