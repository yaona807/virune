# Promotion history ledger version 2

[日本語](self-hosting-promotion-history-v2_ja.md)

Promotion History Ledger version 2 turns trusted `required-selfhost` Promotion Observation runs into durable, replayable history. It preserves exact Git execution provenance while counting by Promotion Subject product identity. It does not approve promotion or change the Production compiler.

## Migration from version 1

Version 1 history cannot prove the version 2 Promotion Subject closure or the complete current required-evidence set. Version 2 therefore starts with an immutable migration record:

- source history version: `1`
- strategy: `fresh-v2-no-backfill`
- promotion credit runs: `0`
- promotion credit days: `0`
- reason: version 1 lacks Promotion Subject closure and current required evidence

Version 1 material may remain available as provenance, but its counters are not copied into version 2.

## Canonical runs and attempts

The ledger stores one logical record per scheduled Promotion Observation GitHub run. Each run retains:

- the provider run ID and creation time used for deterministic ordering;
- the exact execution commit;
- whether the run is frozen;
- every provider attempt that has been observed and canonicalized;
- `promotionEffectiveAttemptCount`, which fixes the prefix of attempts allowed to affect promotion history.

A mutable tail treats every retained attempt as promotion-effective. When a later formal run establishes the freeze boundary, only attempts that completed strictly before that later run's creation time remain in the effective prefix. Attempts that complete at or after the boundary are appended to the same run for auditability but remain outside the effective prefix.

A valid observation artifact keeps independent SHA-256 identities for the GitHub artifact archive and the canonical `observation.json` bytes. The outer observation report must be canonical JSON, carry the exact `required-selfhost-promotion-observation` claim, set `productionEligible: false`, and bind its embedded observation with `observationSha256`. The embedded observation is validated again for canonical version-2 structure, exact logical run and execution commit, countability, evidence ordering, and consistency with the provider workflow conclusion before it enters the ledger.

GitHub/API/transport failures are aggregation failures. They are never converted into an absent-artifact gap.

## Gaps

A formal scheduled run cannot disappear from history merely because its observation artifact is missing or invalid. The ledger records an explicit gap for evidence absence, invalid evidence, incomplete attempts, confirmed workflow infrastructure failure, or cancellation.

Missing or invalid observation evidence is unknown, not infrastructure. A failed workflow attempt that has no valid canonical observation is therefore recorded as `observation-artifact-missing`; the collector does not guess that the failure was infrastructure-related.

Evidence-layer unknowns (`observation-artifact-missing`, `observation-artifact-invalid`, `observation-source-invalid`, and `observation-attempt-incomplete`) are sticky within the logical run. A later successful rerun cannot erase them. Only a confirmed infrastructure failure or cancellation may be superseded by a later valid attempt before freeze.

Gaps are projected as counting synthetic-subject failures. This breaks the current streak without guessing the unknown product safe. If history is `A success → gap → A success`, the later `A` starts a new streak and cannot reconnect the earlier success.

A run whose freeze boundary leaves zero promotion-effective attempts is represented as `observation-attempt-incomplete`; later audit-only attempts cannot retroactively fill that gap.

## Reruns and freezing

A confirmed infrastructure-failed mutable tail, or a cancelled attempt, may recover through a later valid attempt only when that rerun completes before the next formal scheduled run is created. Unknown evidence gaps do not recover through rerun. Once a later formal run establishes the freeze boundary, the run's promotion-effective attempt prefix is immutable.

A product failure is stronger: if any promotion-effective attempt records `product-failed`, later promotion-effective attempts cannot heal that run. Product invalidation also remains effective if the same Promotion Subject appears again later.

Reruns that complete at or after the freeze boundary are still retained in the ledger as an append-only audit suffix. They cannot increase `promotionEffectiveAttemptCount`, repair a gap, heal an infrastructure failure, or introduce a retroactive product failure into already-frozen promotion history.

## Parent ledger and recovery

Each published generation names the SHA-256 of its parent ledger. Existing run identity and retained attempts are append-only. A frozen run must preserve its frozen state and `promotionEffectiveAttemptCount`; it may only append newly observed provider attempts to the audit suffix. A mutable tail may extend its effective prefix only until it freezes.

Aggregation resumes from the newest verified parent report and ledger. This lets old observation artifacts expire without reinterpreting already-canonicalized history. If a retained report refers to a current ledger whose publishing artifact can no longer be proven, aggregation fails closed rather than starting a replacement genesis ledger. A newer successful report also cannot claim that no current ledger exists if an older retained success proves that a ledger had already been published; that rollback is rejected instead of silently restarting version 2 history.

Provider inventories must be complete and ordered. Pagination changes, duplicate provider identities, a missing retained tail, rewritten retained run or attempt metadata, reordered runs, incomplete attempt sequences, or a provider-visible historical run that is absent from the retained ledger are errors. Provider-visible retained runs before the tail are revalidated as well, so a late rerun of an older frozen run can be added to its audit suffix.

Canonical aggregation reports and ledger snapshots are retained for 90 days, while raw Promotion Observation artifacts may expire earlier after their evidence has been incorporated into a verified ledger generation.

## Current-policy replay

Every canonical aggregation replays the current checked-in promotion policy over the ledger projection. Historical successes that lack evidence newly required by the current policy do not become product failures, but they break the current-policy consecutive streak.

The policy evaluator also enforces the repository safety floors. It rejects automatic promotion, lowered blocking thresholds, missing mandatory evidence, disabled manual approval, or weakened Production rollback/stable-release requirements.

Policy replay may report that history thresholds are satisfied, but that result is evidence only. Manual approval and all later promotion conditions remain separate.

## Aggregation workflow

`Self-host promotion history aggregation` runs from `workflow_run: completed`. For that event GitHub binds `github.sha` to the exact default-branch commit for the aggregation run; the workflow checks out that SHA, never the triggering observation's `head_sha`. It uses read-only `actions` and `contents` permissions.

Only the canonical observation workflow path on `main` is accepted. Scheduled observations form formal history; manual observation runs may trigger diagnostic aggregation but are not included in the formal scheduled-run inventory.

A successful aggregation always emits a canonical non-promotable report. A new ledger artifact is emitted only when the canonical generation changes. Aggregation rerun attempts are diagnostic and cannot publish a replacement canonical generation.

## Safety boundaries

Version 2 history does not change the Language Specification, Compiler API, Runtime ABI, Interop ABI, public standard library, promotion thresholds, manual approval policy, or Production compiler selection. It does not delete version 1 history and never infers unknown provider or artifact state as safe.
