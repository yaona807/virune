# npm publication recovery

[English](npm-publication-recovery.md) | [日本語](npm-publication-recovery_ja.md)

This policy applies only after npm publication is enabled by a later reviewed change. It does **not** make the current repository publication-ready.

Every recovery decision begins with a **fresh public npm Registry observation** covering the complete planned package set. Cached, partial, malformed, unavailable, contradictory, or otherwise unknown observations cannot authorize a write. The normal publication gate must also be ready, and all writes must use the exact reviewed release identity from `PUBLICATION-MANIFEST.json`.

An observed package is `exact` only when all required identity evidence agrees: package name, package version, Registry `dist.integrity`, the **downloaded tarball SHA-256** compared with the reviewed candidate, and the provenance-linked **source repository, source commit, and provenance workflow**. Missing or unverifiable identity evidence is not an exact match and therefore cannot authorize recovery writes. The later publication/verification implementation must bind these observation fields to the reviewed release identity; this policy does not invent a substitute when evidence is unavailable.

## Package-version phase

Published npm package versions are treated as irreversible identities.

| Observed state | Decision |
|---|---|
| No planned package version exists | Publish all reviewed candidates, subject to the normal publication gate. |
| An **exact subset** exists and every observed package matches the reviewed identity | Resume the **missing reviewed candidates only**. Never rewrite packages that already exist. |
| All planned versions exist and match | Stop package-version writes and advance to dist-tag promotion. |
| Any bytes, version, provenance, repository/source identity, or other reviewed identity mismatches | The mismatch **permanently blocks reuse of that package version**. A new release version is required. |
| Unexpected or contradictory Registry state | Halt for manual investigation. |
| Observation is unavailable, stale, partial, malformed, timed out, or otherwise unknown | Halt and observe again; **unknown state authorizes no writes**. |

The following are never recovery mechanisms: unpublish/re-publish, rebuilding after review, publishing different bytes under the same version, or publishing from an alternate source head.

## Dist-tag phase

Package-version publication and **dist-tag promotion** are separate phases. Canonical promotion is allowed only after all planned package versions are freshly observed and match the exact reviewed identity.

Stable releases converge to `latest`; approved prereleases converge to `next`; nightly remains unpublished to npm. Recovery must compare the current canonical tag target with the target release using the reviewed release ordering and **never move a canonical tag backward**. If `latest` or `next` already points to a **newer version, recovery is stale and must halt** rather than downgrade the tag. An unexpected or non-canonical target also halts for investigation. Only a missing, older, target-matching, or partially promoted canonical state may proceed with tag convergence.

If canonical tags are only partially promoted, do not republish packages. **Reobserve and converge tags only** until every planned package has the intended canonical tag target.

## Completion

Even after package versions and canonical tags converge, the release is not complete until the separate **public Registry verification** succeeds. That verification remains a blocker in the parent npm publication plan.
