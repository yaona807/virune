# Self-host promotion observation

[日本語](self-hosting-promotion-observation_ja.md)

The `Self-host promotion observation` workflow is the formal observation source for the `required-selfhost` promotion stage. It produces one version 2 observation for a concrete Promotion Subject without changing compiler selection or granting promotion eligibility.

## Formal clock

The workflow runs once per day on the default branch and may also be started manually for diagnostics.

Only a run that is all of the following is countable:

- repository: `yaona807/virune`
- workflow file: `.github/workflows/selfhost-promotion-observation.yml`
- ref: `refs/heads/main`
- event: `schedule`
- source repository is not a fork

The workflow identity is taken from GitHub Actions `workflow_ref`, which binds the repository, workflow file path, and ref. The display name is not used as the security identity.

A manual dispatch executes the same evidence pipeline but is always non-counting. Each logical GitHub run uses its own concurrency group and `cancel-in-progress: false`, so a later scheduled or manual run cannot replace a pending formal observation. Overlap is allowed deliberately; the later history aggregator processes only a complete ordered prefix and stops at an in-progress run. Ordinary `push` and `pull_request` runs are not observation sources.

The observation keeps the exact Git `executionCommit` as provenance and the separate `promotionSubjectId` as product identity.

## Required-selfhost product closure

The Promotion Subject is derived from built product artifacts rather than changed-path classification or the Git commit.

Its version 2 `required-selfhost` closure contains:

- the compiled bootstrap artifact-normalization policy implementation and its relative module closure;
- the verified fixed Seed artifact identity;
- the normalized Stage 3 compiler artifact identity proven by release-core evidence;
- a fixed, versioned set of Self-host Host execution/selection boundary files;
- the built Runtime artifact and Runtime ABI identity;
- the built Standard Library artifact.

The Host component deliberately hashes only the explicit execution/selection boundary file set. It does not recursively absorb the Legacy compiler implementation, differential-test adapters, promotion-history tooling, documentation, or governance metadata. Therefore an unrelated Legacy or documentation change does not reset an unchanged Self-host product, while a change to an explicitly versioned Host boundary does.

The bootstrap normalization policy is different: it is an implementation closure, so its relative imports are followed transitively. Missing files, symlinks, invalid compiled JavaScript, escaping relative imports, malformed release evidence, or inconsistent Seed/Stage 3 identities fail closed.

## Evidence pipeline

Fixed Seed, baseline clean bootstrap, and perturbed clean bootstrap execute in separate jobs. Baseline and perturbed evidence must agree on the exact execution commit, Seed, Stage 1/2/3 identities, lockfile, and Stage 3 candidate identity before cross-runner reproducibility passes.

The observation retains every evidence ID currently required by `required-selfhost` policy. The quality lane explicitly records:

- bootstrap smoke and differential smoke;
- Virune formatting and type checks;
- repository unit tests;
- binding corpus;
- browser integration in managed Chromium, Firefox, and WebKit;
- full conformance and project differential checks;
- stored fuzz regressions plus deterministic Self-host semantic differential fuzz.

Performance evidence compares Legacy and Self-host Project Compiler execution on a fixed project corpus using the existing Self-host Gate D ratios. The edited-rebuild measurement is explicitly a proxy and does not claim incremental-cache coverage.

Each evidence record carries canonical command/environment metadata and SHA-256 digests. The final assembler revalidates release-core and cross-runner self-hashes, Promotion Subject canonicalization, quality evidence self-hashes, the current policy evidence set, and measured performance ratios instead of trusting top-level status strings.

## Failure semantics

A known, attributable product-quality or performance-budget failure can still produce an observation with `outcome: product-failed`. It never fabricates an unexplained differential count.

Missing, malformed, stale-commit, cross-runner-mismatched, incomplete, or otherwise untrusted prerequisite evidence cannot produce a canonical observation. The history aggregation layer records the absent or invalid artifact as a gap instead of guessing it safe.

Infrastructure failure or cancellation is not promoted into a product success. A manual or untrusted-source artifact is non-counting and cannot satisfy the formal history threshold.

## Artifact contract

The workflow uploads exactly one canonical observation artifact when assembly succeeds:

```text
artifact: selfhost-promotion-observation-<run-id>-<run-attempt>
file:     observation.json
```

The artifact is retained for 30 days for version 2 history aggregation and audit. The observation remains `productionEligible: false`; this workflow does not approve promotion, change thresholds, switch the Production compiler, weaken Required Shadow exact-head checks, or retire Shadow History version 1.
