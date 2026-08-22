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
- a fixed, versioned set of Self-host Host execution/selection boundary roots, together with the separately bound Stage-0 project-build runtime closure reached from those roots;
- the built Runtime artifact and Runtime ABI identity;
- the built Standard Library artifact.

The Host component keeps the execution/selection boundary explicit rather than hashing the entire compiler or `selfhost` directory. Every direct runtime import from the fixed Host root set must resolve to another fixed Host root, the separately bound bootstrap-policy component, the Stage-0 project-build closure, a Node built-in, or one of the exact versioned lazy Legacy import boundaries. A newly introduced import outside those bindings fails closed instead of silently becoming an untracked dependency.

Two additional non-literal dynamic-loading boundaries are versioned explicitly because they load generated compiler artifacts rather than repository modules. `selfhost/bootstrap-execution-probe.js` must contain exactly one load of the materialized bootstrap execution candidate, recorded as `generated:bootstrap-execution-candidate-v1`. Its compiled target construction normalizes `entryModulePath`, restricts it to a `.js` module, joins it beneath the materialized candidate root, converts it with `pathToFileURL`, and imports only the resulting `moduleUrl.href`. `selfhost/bootstrap-stage-loader.js` must likewise contain exactly one load of the materialized Stage compiler candidate, recorded as `generated:bootstrap-stage-compiler-candidate-v1`; the selected emitted entry module is joined beneath that materialized stage root, converted to a file URL, and only that `moduleUrl.href` is imported. In both cases the esbuild warning site, normalized source contract, exact occurrence count, and the SHA-256 of the complete whitespace-normalized compiled loader module must agree with the reviewed boundary. The whole-module digest is an eligibility check only and is not added to the Promotion Subject manifest separately from the already-bound Host bytes. Changing materialization, entry selection, call-site provenance, or the target expression; removing or duplicating either load; adding another non-literal dynamic import; or introducing non-literal dynamic loading in any other Host module fails closed. Non-analyzable `require()` remains forbidden everywhere.

The Stage-0 project builder is an execution dependency of bootstrap readiness and the execution probe, so `project/project.js` is not left outside product identity. Its actual runtime input graph is resolved from the built checkout with Node-oriented package conditions and entry-field selection, and hashed transitively, including the concrete installed package bytes that the compiler pipeline executes. The closure does not trust package `sideEffects` annotations to erase bare runtime imports. It rejects unresolved non-Node externals, non-analyzable dynamic `import()` or `require()` loading, CommonJS inputs whose require closure has not been modeled explicitly, path escape, symlink traversal, or malformed inputs. This binds compiler-pipeline dependencies such as the parser and source-map implementation without hashing unrelated packages, documentation, promotion-history tooling, or the whole lockfile.

The Legacy adapter remains outside the Self-host product identity and is loaded only through the exact dynamic-import boundaries used when the explicit Legacy path is selected. The Self-host MVP load path therefore does not acquire the Legacy implementation as a hidden runtime dependency. An unrelated Legacy, documentation, or governance-only change does not reset an unchanged Self-host product, while a change to a fixed Host boundary or its bound project-build runtime closure does.

The bootstrap normalization policy is different: it is a separately named implementation closure, so its relative imports are followed transitively. Non-analyzable dynamic `import()` or `require()` targets are rejected instead of being treated as an untracked runtime dependency. Missing files, symlinks, invalid compiled JavaScript, escaping relative imports, malformed release evidence, or inconsistent Seed/Stage 3 identities fail closed.

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

Each evidence record carries canonical command/environment metadata and SHA-256 digests. The final assembler revalidates release-core and cross-runner self-hashes, Promotion Subject canonicalization, quality evidence self-hashes, the current policy evidence set, and measured performance ratios instead of trusting top-level status strings. Before writing the artifact, it also replays the canonical observation against the current blocking promotion-policy safety contract. A weakened threshold, unsupported blocking-policy field, or other invalid current policy therefore fails closed without producing a canonical observation.

## Failure semantics

A known, attributable product-quality or performance-budget failure can still produce an observation with `outcome: product-failed`. It never fabricates an unexplained differential count.

A managed-browser test can terminate non-zero because of either product behavior or the browser/runner environment. The quality lane does not infer product fault from that ambiguous exit code. It records the command's non-zero classification as `infrastructure-unknown`, which prevents a canonical product-failure observation; the later history layer records the resulting missing/invalid observation as a streak-breaking gap. This deliberately prefers an unknown gap over permanently invalidating a product without attributable evidence.

Missing, malformed, stale-commit, cross-runner-mismatched, incomplete, or otherwise untrusted prerequisite evidence cannot produce a canonical observation. The history aggregation layer records the absent or invalid artifact as a gap instead of guessing it safe.

Infrastructure failure or cancellation is not promoted into a product success. A manual or untrusted-source artifact is non-counting and cannot satisfy the formal history threshold.

## Artifact contract

The workflow uploads exactly one canonical observation artifact when assembly succeeds:

```text
artifact: selfhost-promotion-observation-<run-id>-<run-attempt>
file:     observation.json
```

The artifact is retained for 30 days for version 2 history aggregation and audit. The observation remains `productionEligible: false`; this workflow does not approve promotion, change thresholds, switch the Production compiler, weaken Required Shadow exact-head checks, or retire Shadow History version 1.
