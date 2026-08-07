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

## Legacy rollback smoke

Run `npm run selfhost:rollback-smoke` from a clean Git checkout after dependencies are installed. The command builds the repository, intentionally marks only the `performance` gate as failed, and then executes the rollback selection boundary with an inaccessible Self-host candidate. A successful smoke proves that:

- the rollback decision selects the real Legacy compiler path;
- the unavailable Self-host candidate is never read or materialized;
- the canonical smoke program compiles successfully through Legacy;
- the tracked and untracked Git working tree was clean when the proof ran.

The command writes JSON evidence under `.cache/selfhost/legacy-rollback-smoke.json` by default. The regular source-clone smoke lane also runs the same rollback proof after the canonical build and writes `.cache/ci-timings/selfhost-legacy-rollback-smoke.json`, so CI retains it with timing evidence.

This smoke deliberately uses a synthetic unavailable candidate and records `productionEligible: false`. It proves the fallback mechanism only; it is not candidate promotion evidence and cannot switch the production default.

## Boundary

This artifact is evidence only. It does not switch the compiler, change workflows or branch protection, modify the production default, or alter the grammar, stable Compiler API, Runtime ABI, Interop ABI, or public standard library.
