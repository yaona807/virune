# npm publication recovery

[English](npm-publication-recovery.md) | [日本語](npm-publication-recovery_ja.md)

This policy applies only after npm publication is enabled by a later reviewed change. It does **not** make the current repository publication-ready.

Every recovery decision begins with a **fresh public npm Registry observation** covering the complete planned package set. Cached, partial, malformed, unavailable, contradictory, or otherwise unknown observations cannot authorize a write. The normal publication gate must also be ready, and all writes must use the exact reviewed release identity from `PUBLICATION-MANIFEST.json`.

An observed package version is `exact` only when all immutable identity evidence agrees. The package name must equal the publication-manifest Registry name; the package version must equal the publication-manifest version; registry `dist.integrity` must verify the downloaded tarball; the **downloaded tarball SHA-256** must equal the reviewed candidate SHA-256; and the provenance-linked **source repository, source commit, and provenance workflow** must equal the reviewed/approved release identity. Missing or unverifiable identity evidence is not an exact match and therefore cannot authorize recovery writes. Canonical dist-tags are mutable Registry state and are checked separately; they are not redefined as package-version identity.

## Package-version recovery

Published npm package versions are irreversible identities.

| Observed state | Decision |
|---|---|
| No planned package version exists | Publish the reviewed candidates in dependency-safe order, subject to the normal publication gate. |
| An **exact subset** exists and every observed package matches the reviewed identity | Resume the **missing reviewed candidates only**. Never rewrite packages that already exist. |
| All planned versions exist and match | Perform no package-version write. Continue to the separate public Registry verification boundary. |
| Any bytes, version, provenance, repository/source identity, or other immutable reviewed identity mismatches | The mismatch **permanently blocks reuse of that package version**. A new release version is required. |
| Unexpected or contradictory Registry state | Halt for manual investigation. |
| Observation is unavailable, stale, partial, malformed, timed out, or otherwise unknown | Halt and observe again; **unknown state authorizes no writes**. |

The following are never recovery mechanisms: unpublish/re-publish, rebuilding after review, publishing different bytes under the same version, or publishing from an alternate source head.

## Canonical dist-tag application

The normal path uses npm Trusted Publishing/OIDC. npm currently authenticates `npm publish` and `npm stage publish` through Trusted Publishing, but not a separate `npm dist-tag add/rm` command. Virune therefore applies the reviewed channel tag directly with **`npm publish --tag`** instead of creating a second token-authenticated tag-promotion phase.

Stable releases use `latest`; approved prereleases use `next`; nightly remains unpublished to npm. Publication uses a **dependency-safe order** and publishes the **CLI last**. When a package's canonical tag becomes visible, every exact Virune package dependency required by that package must already exist in the Registry. The `virune` CLI is not advanced until all five planned dependency packages are exact.

Before publishing a missing target version, the current canonical tag target is compared with the reviewed target using **SemVer precedence**. The normal path **never moves a canonical tag backward**: if the current `latest` or `next` target is equal to or newer than the reviewed target, publication halts before `npm publish --tag`. A malformed target or a tag that points outside the observed package version set also halts fail-closed.

For retry, an already-existing `name@version` is skippable only when its immutable package identity matches and its canonical tag already points to the reviewed version. A mismatching or externally drifted canonical tag does not change the immutable package-version identity, but it does halt the normal publication path. Recovery **does not use a separate `npm dist-tag` mutation** and does not introduce a **traditional token fallback** to repair tags. Such a state requires explicit external investigation rather than silently weakening the Trusted Publishing boundary.

After all writes or skips, the complete planned package set is observed again. Publication does not report convergence unless every package is still exact and the canonical tag state still matches the reviewed release.

## Completion

Even after all package versions converge, the release is not complete until the separate **public Registry verification** succeeds. That verification remains a blocker in the parent npm publication plan and must exercise the Registry-installed consumer path.
