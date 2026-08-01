# Self-hosting rollback decision evidence

The rollback decision evaluator converts candidate-bound gate evidence into a deterministic operational decision.

## Fail-closed rule

The self-host compiler remains selected only when every required gate is present, bound to the exact candidate SHA-256, current within the configured evidence age, and passing. Otherwise the decision selects the Legacy compiler and marks rollback as required.

Required gates are:

- bootstrap determinism
- Legacy compatibility
- runtime behaviour
- performance
- clean bootstrap
- rollback smoke

Missing, stale, failed, and subject-mismatched evidence are retained as explicit, canonically ordered reasons. Input ordering does not affect the serialized decision or its SHA-256.

## Boundary

This artifact is evidence only. It does not switch the compiler, change workflows or branch protection, modify the production default, or alter the grammar, stable Compiler API, Runtime ABI, Interop ABI, or public standard library.
