# Promotion shadow history version 2

[日本語](self-hosting-promotion-shadow-history-v2_ja.md)

Shadow History version 2 aggregates long-running promotion observations by **promotion subject identity**, not by Git commit identity. It runs in parallel with the existing version 1 contract during migration.

Every entry still records the exact 40-character Git `executionCommit` for provenance. A separate 64-character `promotionSubjectId` identifies the stage-specific product closure being observed. Different execution commits can therefore contribute to one streak only when the promoted product identity is unchanged.

## Subject segments

History is ordered by canonical completion time and run ID. The latest **counting** observation selects the current formal promotion subject. Only the contiguous trailing segment of counting observations with that subject can contribute to current history. If counting identities move A → B → A, the second A starts a new formal segment; earlier A observations are never resurrected.

Non-counting diagnostics retain their own `promotionSubjectId` for auditability but do not move the current formal subject or start/reset a formal subject segment. If history contains no counting observation at all, the latest diagnostic subject is exposed as the informational subject identity while all formal counters remain zero.

## Outcome and counting semantics

Each run records an outcome and an independent `countsTowardPromotion` flag.

- counting `passed` observations extend the trailing successful-run streak;
- counting `infrastructure-failed` or `cancelled` observations reset the streak without permanently invalidating the product subject;
- counting `product-failed` observations invalidate that promotion subject and force its successful-run/day counts to zero, even if the same subject identity reappears after another subject;
- non-counting observations remain auditable but neither increment nor reset the formal streak or move the formal promotion subject.

Only `product-failed` observations may carry non-zero unexplained differentials. Infrastructure failure and cancellation are streak-break/provenance outcomes, not permanent product-differential evidence, so their unexplained differential count must remain zero. Distinct UTC dates are counted independently from successful run count, so multiple same-day runs cannot inflate observation days.

The later observation-collection layer decides which trusted workflow events may set `countsTowardPromotion=true`.

## Boundaries

Version 2 history does not select trusted GitHub events, evaluate the current promotion policy, approve promotion, switch the Production compiler, or retire version 1 history. It also does not infer product identity from changed file paths.
