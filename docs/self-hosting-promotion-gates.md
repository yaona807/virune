# Self-host promotion gates

[日本語](self-hosting-promotion-gates_ja.md)

Virune self-hosting moves from informational validation to the Production compiler only through the versioned policy in `.github/self-hosting/promotion-policy-v1.json`.

## Fail-closed rules

- Promotion is never automatic.
- Every stage after pull-request information requires explicit approval.
- Unexplained Legacy／Self-host differences must remain zero.
- A later stage may add evidence but may not remove evidence required by an earlier stage.
- Blocking stages require both consecutive successful runs and a minimum observation period.
- Production requires rollback evidence, release reproducibility, ABI／Compiler API compatibility, and at least one completed stable release cycle.

Passing the numeric thresholds makes a stage eligible for review. It does not promote the compiler by itself.

## Stage sequence

| Stage | Blocking | Minimum history | Scope |
| --- | --- | --- | --- |
| `pr-informational` | No | None | Pull-request smoke checks |
| `nightly-shadow` | No | Explicit approval | Nightly full shadow validation |
| `required-selfhost` | Yes | 14 successful runs over 14 days | Self-host-related changes |
| `required-compiler` | Yes | 28 successful runs over 28 days | All compiler changes |
| `production-default` | Yes | 30 successful runs over 30 days and one stable release cycle | Production compiler selection |

## Verification

```bash
node scripts/verify-selfhost-promotion-policy.mjs
node --test scripts/verify-selfhost-promotion-policy.test.mjs
```

The dedicated GitHub Actions workflow runs both commands when the policy, verifier, tests, or this documentation changes.

This policy defines promotion eligibility only. It does not yet implement Stage 1／Stage 2 generation, switch the Production compiler, remove the Legacy compiler, or weaken any existing quality gate.
