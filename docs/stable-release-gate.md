# Stable release gate

Virune can be promoted to the `stable` channel only when all of the following are true.

- Formatter comments preserve their semantic anchor, formatting is idempotent, and the formatter regression/fuzz suites pass.
- Every child task is cancelled and settled before its scope completes; timeout and sibling-failure paths pass on Node.js and browser runtimes.
- The stable Compiler API snapshot and package export map pass compatibility checks.
- Normative rule coverage is 100%, with no documentation file counted as a test.
- Node.js and browser conformance suites pass from a clean install.
- FFI Unknown fallbacks and unsafe boundaries are reported and documented.
- Parser, formatter, and checker crash-fuzz suites pass.
- Public packages install and execute in a clean environment.
- The pinned npm binding corpus reproduces its reviewed hashes and meets its success/non-empty thresholds.
- Scheduled long fuzz runs have accumulated reviewed evidence without unresolved crash regressions.
