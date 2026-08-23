# npm publication recovery

[English](npm-publication-recovery.md) | [日本語](npm-publication-recovery_ja.md)

This policy applies only after npm publication is enabled by a later reviewed change. It does **not** make the current repository publication-ready.

Every recovery decision begins with a **fresh public npm Registry observation** covering the complete planned package set. Cached, partial, malformed, unavailable, contradictory, or otherwise unknown observations cannot authorize a write. The normal publication gate must also be ready, and all writes must use the exact reviewed release identity from `PUBLICATION-MANIFEST.json`.

An observed package is `exact` only when all required identity evidence agrees. The package name must equal the publication-manifest Registry name; the package version must equal the publication-manifest version; registry `dist.integrity` must verify the downloaded tarball; the **downloaded tarball SHA-256** must equal the reviewed candidate SHA-256; and the provenance-linked **source repository, source commit, provenance workflow, and canonical dist-tag** must equal the reviewed/approved release identity. Missing or unverifiable identity evidence is not an exact match and therefore cannot authorize recovery writes.

## Package-version recovery

Published npm package versions are irreversible identities.

| Observed state | Decision |
|---|---|
| No planned package version exists | Publish the reviewed candidates in dependency-safe order, subject to the normal publication gate. |
| An **exact subset** exists and every observed package matches the reviewed identity | Resume the **missing reviewed candidates only**. Never rewrite packages that already exist. |
| All planned versions exist and match | Perform no package-version write. Continue to the separate public Registry verification boundary. |
| Any bytes, version, provenance, repository/source identity, canonical tag, or other reviewed identity mismatches | The mismatch **permanently blocks reuse of that package version**. A new release version is required unless the mismatch is an independently repairable external configuration error that does not alter the immutable package version. |
| Unexpected or contradictory Registry state | Halt for manual investigation. |
| Observation is unavailable, stale, partial, malformed, timed out, or otherwise unknown | Halt and observe again; **unknown state authorizes no writes**. |

The following are never recovery mechanisms: unpublish/re-publish, rebuilding after review, publishing different bytes under the same version, or publishing from an alternate source head.

## Canonical dist-tag application

The normal path uses npm Trusted Publishing/OIDC. npm currently authenticates `npm publish` and `npm stage publish` through Trusted Publishing, but not a separate `npm dist-tag add/rm` command. Virune therefore applies the reviewed channel tag directly with **`npm publish --tag`** instead of creating a second token-authenticated tag-promotion phase.

Stable releases use `latest`; approved prereleases use `next`; nightly remains unpublished to npm. Publication uses a **dependency-safe order** and publishes the **CLI last**. When a package's canonical tag becomes visible, every exact Virune package dependency required by that package must already exist in the Registry. The `virune` CLI is not advanced until all five planned dependency packages are exact.

For retry, an already-existing `name@version` is skippable only when its bytes, provenance/source identity, and canonical tag all match the reviewed release. A mismatching or externally drifted canonical tag halts the normal path. Recovery **does not use a separate `npm dist-tag` mutation** and does not introduce a **traditional token fallback** to repair tags. Such a state requires explicit external investigation rather than silently weakening the Trusted Publishing boundary.

## Completion

Even after all package versions converge, the release is not complete until the separate **public Registry verification** succeeds. That verification remains a blocker in the parent npm publication plan and must exercise the Registry-installed consumer path.
