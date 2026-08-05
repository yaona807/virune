## Intent

<!-- One sentence describing the single reviewable purpose of this PR. -->

## Change classification

- [ ] Feature / correctness / evidence
- [ ] Operations / policy
- [ ] Shared CI or dependency repair
- [ ] Diagnostic-only temporary exception

## Dependency and branch topology

- Base branch:
- Parent PR or dependency: `none`
- Stack depth: `not stacked`
- Why a stack is required: `not applicable`
- Overlapping paths with the parent: `none`

<!-- Normal maximum: parent + child. A third open level requires explicit justification. -->

## Intended changed boundaries

<!-- List the files, subtrees, public contracts, or generated artifacts that are intentionally changed. -->

- 

## Validation

<!-- Prefer repository-owned commands. Include exact commands and results. -->

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
- [ ] The dependency and stack position are accurate.
- [ ] The normal stack depth is at most two open levels, or the exception is justified.
- [ ] No ancestry-only or zero-change repair PR is required.
- [ ] Repository-owned diagnostics were used before introducing a temporary execution path.
- [ ] Required quality, compatibility, security, and reproducibility gates are not weakened or bypassed.
- [ ] Temporary artifacts have an explicit removal trigger and are excluded from merge.
- [ ] English and Japanese operational documentation are synchronized when applicable.
- [ ] The PR description identifies the evidence needed to close any superseded diagnostic-only PR.

See `.github/self-hosting-operations/README.md` and `README_ja.md` for the complete policy.
