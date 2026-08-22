# Promotion policy replay version 2

[日本語](self-hosting-promotion-policy-replay-v2_ja.md)

Promotion policy replay applies the **current** checked-in promotion requirements to canonical Shadow History version 2 evidence. It does not change product identity and does not trust the historical decision that a run once counted.

The replay layer fails closed on policy structure it does not understand. Unknown fields at the policy root, the selected blocking stage, or that stage's promotion requirements are rejected rather than ignored. The selected stage must also retain the canonical required-evidence and threshold safety floors, so a weakened or semantically extended policy cannot silently become acceptable to an older replay implementation.

A previously successful run qualifies under the current policy only when it was originally a trusted/counting observation and its retained evidence contains every evidence ID currently required by the stage with `passed` status. If a later policy adds evidence D, old runs that never recorded D become non-qualifying. They are not retroactively labeled product failures. A non-qualifying formal observation breaks the current-policy consecutive streak, while old runs that already recorded D can continue to qualify.

Current-policy subject segments are formed only from counting observations. Non-counting diagnostics retain audit evidence but cannot move the formal promotion subject, split its subject segment, or interrupt a current-policy streak merely because the diagnostic carries a different `promotionSubjectId`.

Recorded counting failures remain failures. In particular, product failure continues to invalidate the same promotion subject, while infrastructure failure or cancellation remains a streak break. Policy strengthening must never erase failure evidence.

## Trusted observation source

A separate pure source classifier compares the run source with caller-supplied canonical repository, workflow, ref, and event values. The trusted event itself must be exactly `schedule`; a caller cannot make dispatch, push, or pull-request events countable by choosing another trusted event. Counting requires the source repository, workflow, ref, and event to match that trusted contract and the source not to be a fork. Manual dispatch, push, pull-request, fork, or mismatched source runs are diagnostic only.

The classifier does not hard-code Virune repository paths into product identity. GitHub Actions wiring supplies the trusted source contract in the next slice.

## Output

Replay reports the current promotion subject, required evidence set, successful-run count, distinct UTC observation days, permanent product-invalidated state, unexplained differentials, policy thresholds, qualifying run IDs, excluded runs with reasons, and whether the history-only thresholds are satisfied.

Manual approval, rollback evidence, and stable release cycle remain separate requirements. A history-threshold pass is not a promotion action.
