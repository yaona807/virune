# Performance benchmarks

Virune tracks Language Server completion latency and JavaScript / TypeScript interop heap retention in a dedicated GitHub Actions workflow.

## Commands

Build once, then run the benchmarks and comparison:

```sh
npm run check
npm run benchmark:lsp:built -- --runs=5 --output=.cache/performance/lsp.json
npm run benchmark:interop-heap:built -- --output=.cache/performance/interop.json
npm run check:performance -- \
  --baseline=benchmarks/performance/baseline.json \
  --lsp=.cache/performance/lsp.json \
  --interop=.cache/performance/interop.json \
  --output=.cache/performance/comparison.json
```

`npm run benchmark:lsp` and `npm run benchmark:interop-heap` remain available for one-off local runs that build first.

## CI execution

`.github/workflows/performance.yml` runs:

- every Monday at 03:17 UTC;
- through `workflow_dispatch`;
- on pull requests that change the Language Server, compiler, JS interop, benchmark scripts, baseline, or workflow.

The job is fixed to Ubuntu 24.04 and Node.js 24. LSP scenarios run five times and use the median for each metric. The workflow uploads the raw LSP samples, heap report, and comparison report as JSON artifacts.

## Regression policy

The tracked baseline is `benchmarks/performance/baseline.json`.

A completion metric fails only when both conditions are true:

1. the measured median exceeds the baseline multiplied by `relativeMultiplier`;
2. the measured median exceeds the baseline plus the metric's absolute increase allowance.

Combining relative and absolute limits prevents tiny edited-completion values from failing on harmless percentage changes while still detecting material regressions.

JS interop fails when retained heap drift exceeds the configured absolute limit, the cache is not exercised before disposal, or cache entries remain after disposal.

## Updating the baseline

Baseline changes must be reviewable and justified.

1. Run the performance workflow repeatedly on Ubuntu 24.04 / Node.js 24.
2. Confirm the change is intentional and not runner noise or an unrelated regression.
3. Use medians from multiple successful runs.
4. Update `benchmarks/performance/baseline.json` in a dedicated PR, or in a clearly separated commit whose description explains the cause.
5. Include links or attached JSON artifacts supporting the new values.
6. Do not raise thresholds merely to make a failing implementation pass.

Changing an implementation does not automatically require changing the baseline. Prefer retaining the existing baseline when performance improves or stays within the documented limits.
