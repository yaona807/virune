# Self-host promotion subject identity

[日本語](self-hosting-promotion-subject_ja.md)

Virune promotion evidence separates **where a check ran** from **what product is being observed**.

- The execution commit is Git provenance. Pull-request evidence remains bound to the exact head commit.
- The promotion subject is product identity. Long-running observation history can continue across repository commits only while the stage-specific product closure remains identical.

This separation prevents documentation or governance-only commits from resetting an otherwise unchanged compiler observation while preserving exact-head auditability.

## Version 2 manifest

`PromotionSubjectManifest` version 2 contains only a promotion stage and the exact SHA-256 identities required by that stage. It intentionally does not contain a Git commit. Components are canonicalized into the versioned stage order, serialized as canonical JSON, and hashed with SHA-256. The result is `promotionSubjectId`.

All digests must be lowercase 64-character SHA-256 strings. Missing, duplicate, extra, malformed, or unknown components fail closed. The component taxonomy is part of the versioned contract rather than being inferred from changed repository paths.

## Stage closures

| Stage | Product closure |
| --- | --- |
| `required-selfhost` | bootstrap policy, fixed Seed, Stage 3 compiler artifact, Self-host Host contract, runtime artifact/ABI, standard library artifact |
| `required-compiler` | everything above plus compiler Host, JavaScript/TypeScript Interop, Compiler API, Interop ABI, and dependency closure |
| `production-default` | everything above plus the reviewed release artifact and release reproducibility identity |

Each later stage is a strict superset of the earlier product closure. The stage name is included in the canonical manifest, so identities are domain-separated even when shared component digests are identical.

## Boundaries

This contract does not change promotion thresholds, evaluate observation history, alter Nightly or Required Shadow workflows, approve a promotion, switch the Production compiler, or retire Shadow History version 1. Those changes are separate migration slices.

Promotion policy is also not a product component. A policy change must re-evaluate recorded runs against the current required evidence rather than silently changing the identity of an unchanged product.
