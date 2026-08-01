# Full-language Lowering Inventory

`selfhost-full-language-inventory.test.ts` compiles the canonical Virune self-host source set with the generated Stage 0 project compiler and emits one deterministic diagnostic inventory.

The inventory groups diagnostics by code and message, counts occurrences, records the sorted source paths that trigger each group, and reports any generated-result ordering defects in `boundaryBlockers`. It verifies that:

- the generated compiler still reports the explicit `full-language-lowering-not-implemented` capability blocker;
- every canonical source is parsed;
- the current full self-host project remains fail-closed;
- repeated raw project compilation produces byte-equivalent results and inventory data;
- the obsolete `SHP2001` project-linking placeholder never reappears;
- non-canonical dependency or exported-symbol metadata is measured explicitly instead of being hidden by Host normalization.

The CI log line begins with `SELFHOST_FULL_LANGUAGE_INVENTORY`. That machine-readable JSON is the input for splitting the remaining work into canonical project metadata, declaration/type, expression/control-flow, effect/async, and runtime/derive lanes. The test is intentionally removed or inverted as each measured blocker is eliminated and the full source set becomes accepted.
