# Fuzz regression corpus

`npm run test:fuzz:long` stores a minimized reproduction candidate and JSON metadata in `fuzz-regressions/artifacts/` whenever an invariant fails.

After reviewing a failure, move the smallest reproducible source into the relevant package test fixtures and add a deterministic regression test. CI uploads the raw nightly artifacts even when the workflow fails.
