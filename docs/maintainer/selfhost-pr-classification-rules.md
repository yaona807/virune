# Self-hosting PR classification rules

The operations baseline uses deterministic heuristics over final GitHub pull-request metadata. Rules are intentionally conservative and produce lower-bound counts when the final snapshot cannot prove an event.

## Input scope

- Repository and author are explicit command arguments.
- The window contains the latest `N` authored PRs ordered by creation time descending.
- The default window is 50 PRs.
- Each PR includes title, body, state, merged status, commit count, and changed file paths.
- A PR with more than 100 changed files fails closed until file pagination is implemented.

## Title prefix

The first conventional-commit-style prefix is recorded:

- `feat`
- `fix`
- `test`
- `chore`
- `docs`
- `refactor`
- `build`
- `ci`
- `perf`
- `other`

The prefix is descriptive only. Operational classification is evaluated separately.

## Exclusive operational classification

Rules are applied in this order.

### Diagnostic-only temporary

A PR is classified as `diagnostic-only-temporary` when its title or body references diagnostics and also states one of the following:

- it will not be merged;
- it does not modify source files;
- it is used only to run a diagnostic.

### History or ancestry repair

A PR is classified as `history-ancestry-repair` when:

- it references ancestry, rebuilt parent history, or connecting history; and
- it has zero commits or explicitly states that it exists only to resolve the history relationship.

### Shared CI or dependency repair

A PR is classified as `shared-ci-dependency-repair` when:

- its title begins with `fix(deps):`; or
- its body references both a shared gate and dependency repair.

### Feature, correctness, or evidence

All remaining PRs are classified as `feature-correctness-evidence`.

This class includes implementation, tests, deterministic evidence, and ordinary correctness fixes. It does not imply equal product value; it separates product/evidence work from transport and recovery work.

## Non-exclusive evidence flags

### Temporary execution

Set when the PR:

- is diagnostic-only temporary; or
- explicitly references a temporary workflow or self-removing workflow.

### Stack or dependency chain

Set when the PR explicitly references:

- `Depends on #...`;
- a stacked PR or stacked implementation lane;
- `based on #...`.

### Rebuild or normalization

Set when the title or body explicitly references:

- `rebuilt`;
- `rebuild`;
- normalization on the current base.

## Core file concentration

The report selects the latest self-host PRs that changed at least one of:

- `selfhost/mvp/src/parser.virune`
- `selfhost/mvp/src/checker.virune`
- `selfhost/mvp/src/emitter.virune`
- `selfhost/mvp/src/model.virune`

The default representative sample size is 14 PRs. Counts measure how many sampled PRs changed each core file.

## Change control

A classification-rule change must include:

1. an updated rule document;
2. updated unit fixtures;
3. an explanation of how the historical baseline changes;
4. no removal of unfavorable cases solely to improve the metric.

The script must fail rather than silently truncate data that would materially change the report.
