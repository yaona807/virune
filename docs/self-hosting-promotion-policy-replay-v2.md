# Promotion policy replay version 2

[日本語](self-hosting-promotion-policy-replay-v2_ja.md)

Promotion policy replay applies the **current** checked-in promotion requirements to canonical Shadow History version 2 evidence. It does not change product identity and does not trust the historical decision that a run once counted.

A previously successful run qualifies under the current policy only when it was originally a trusted/counting observation and its retained evidence contains every evidence ID currently required by the stage with `passed` status. If a later policy adds evidence D, old runs that never recorded D become non-qualifying. They are not retroactively labeled product failures. A non-qualifying formal observation breaks the current-policy consecutive streak, while old runs that already recorded D can continue to qualify.

Recorded counting failures remain failures. In particular, product failure continues to invalidate the same promotion subject, while infrastructure failure or cancellation remains a streak break. Policy strengthening must never erase failure evidence.

## Trusted observation source

A separate pure source classifier compares the run source with caller-supplied canonical repository, workflow, and ref values. Counting requires all of them to match, `eventName` to be exactly `schedule`, and the source not to be a fork. Manual dispatch, push, pull-request, fork, or mismatched source runs are diagnostic only.

The classifier does not hard-code Virune repository paths into product identity. GitHub Actions wiring supplies the trusted source contract in the next slice.

## Output

Replay reports the current promotion subject, required evidence set, successful-run count, distinct UTC observation days, permanent product-invalidated state, unexplained differentials, policy thresholds, qualifying run IDs, excluded runs with reasons, and whether the history-only thresholds are satisfied.

Manual approval, rollback evidence, and stable release cycle remain separate requirements. A history-threshold pass is not a promotion action.
