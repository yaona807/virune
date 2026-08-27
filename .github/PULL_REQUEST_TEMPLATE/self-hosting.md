## Intent

<!-- One sentence describing the single reviewable purpose of this PR. -->

## Implementation issue

Refs #

<!-- Required for a normal Self-hosting implementation PR. Reference an Issue whose `Work item role` is `Implementation`. Use plain `Refs`; do not use `Closes`, `Fixes`, `Resolves`, or a GitHub closing relationship as the normal completion mechanism. -->

## Tracking / parent issues

<!-- Use plain `Refs #...` for any Tracking parent, or write `None`. A Tracking Issue is not a substitute for the Implementation Issue above. -->

## Change classification

- [ ] Feature / correctness / evidence
- [ ] Operations / policy
- [ ] Shared CI or dependency repair
- [ ] Diagnostic-only temporary exception

## Dependency and branch topology

<!-- GitHub is authoritative for the mutable current PR base/head. Do not maintain copied current base/head SHA or branch fields here. -->

- Parent PR or dependency: `none`
- Stack depth: `not stacked`
- Why a stack is required: `not applicable`
- Overlapping paths with the parent: `none`

<!-- Maximum: parent + child. Do not open a third level. -->

## Intended changed boundaries

<!-- List the files, subtrees, public contracts, or generated artifacts that are intentionally changed. -->

- 

## Validation

<!-- Prefer repository-owned commands. Include exact commands and results. When formal CI or another evidence item belongs to one immutable commit, identify that exact SHA with the evidence. -->

```bash
# npm run selfhost:inventory
# npm run selfhost:focused -- --case=<case-id>
# npm run selfhost:reconstruct -- --case=<case-id>
```

- Local / focused result:
- Formal workflow status:

## CI failure classification

- [ ] No known failure
- [ ] Feature regression
- [ ] Shared infrastructure
- [ ] Retryable transient
- [ ] Unknown; investigation required before retry

Evidence or run identifiers: `none`

## Temporary artifacts

- Temporary workflow, diagnostic PR, bridge script, or generated report: `none`
- Removal trigger: `not applicable`
- Responsible PR: `not applicable`
- Merge disposition: `not applicable`

<!-- A temporary mechanism must be removed before this PR becomes ready for review and must not weaken an existing gate. -->

## Remaining work

<!-- State work intentionally excluded from this PR. -->

- 

## Review checklist

- [ ] This PR has one reviewable intent.
- [ ] The Implementation Issue and any Tracking/parent references use the repository-wide work-item contract.
- [ ] The dependency and stack position are accurate.
- [ ] The stack depth is at most two open levels.
- [ ] No ancestry-only or zero-change repair PR is required.
- [ ] Repository-owned diagnostics were used before introducing a temporary execution path.
- [ ] Required quality, compatibility, security, and reproducibility gates are not weakened or bypassed.
- [ ] Any cited formal CI evidence belongs to the actual current PR head.
- [ ] Temporary artifacts have an explicit removal trigger and are excluded from merge.
- [ ] English and Japanese documentation are synchronized when applicable.
- [ ] The PR description identifies the evidence needed to close any superseded diagnostic-only PR.

See `CONTRIBUTING.md` and `CONTRIBUTING_ja.md` for the repository-wide workflow and Self-hosting constraints.
