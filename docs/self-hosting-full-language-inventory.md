# Full-language Lowering Inventory

`selfhost-full-language-inventory.test.ts` compiles the canonical Virune self-host source set with the generated Stage 0 project compiler and emits one deterministic diagnostic inventory.

The inventory groups diagnostics by code and message, counts occurrences, and records the sorted source paths that trigger each group. It verifies that:

- the generated compiler still reports the explicit `full-language-lowering-not-implemented` capability blocker;
- every canonical source is parsed;
- the current full self-host project remains fail-closed;
- repeated compilation produces byte-equivalent results and inventory data;
- the obsolete `SHP2001` project-linking placeholder never reappears.

The CI log line begins with `SELFHOST_FULL_LANGUAGE_INVENTORY`. That machine-readable JSON is the input for splitting full-language lowering into independent declaration, expression/control-flow, effect/async, and runtime/derive work lanes. The test is intentionally removed or inverted when the full source set becomes accepted.
