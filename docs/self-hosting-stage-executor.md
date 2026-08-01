# Bootstrap Stage Executor

`bootstrap-stage-executor.ts` provides the deterministic Host-side boundary that drives Stage 1 and Stage 2 once the Virune project compiler capability becomes ready.

The executor:

1. compiles the canonical project input with the Stage 0 compiler;
2. normalizes the emitted Stage 1 module set;
3. loads that Stage 1 artifact through an injected loader;
4. recompiles the same input to Stage 2;
5. compares normalized artifact hashes and per-module hashes.

The stage label is excluded from the hashed payload. CRLF and CR are normalized to LF before hashing. Added, removed, and changed output modules are reported in canonical output-path order.

This module does not change the production compiler route and does not perform filesystem access itself. The caller owns materialization and module loading.
