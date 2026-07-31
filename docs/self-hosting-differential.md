# Self-hosting differential harness

[日本語](self-hosting-differential_ja.md)

The differential harness compares the legacy TypeScript compiler and the future Virune compiler kernel through the same versioned `KernelInput` contract. It is internal to the self-hosting path and does not change the production compiler facade.

## Compared surfaces

Each side is compiled independently and normalized before comparison. The report covers:

- accepted or rejected status;
- diagnostic code, severity, source range, related information, help, fixes, and panic data;
- exported symbols and dependency metadata;
- emitted JavaScript modules and parsed, canonically serialized source maps;
- compilation statistics;
- runtime return value, standard output, standard error, exit code, signal, panic, and ordered output events.

No field is silently ignored. Arrays with set-like semantics are sorted canonically, object keys are serialized in order, line endings are normalized, and source paths are project-relative. A remaining difference must either be explained by an active fixture policy or fail the comparison.

## Local smoke corpus

Build the repository and compare the current legacy implementation with itself:

```bash
npm run selfhost:differential:smoke
```

Run one fixture:

```bash
npm run build
node scripts/run-selfhost-differential.mjs --fixture=smoke-multi-module
```

The committed corpus is `.github/self-hosting/differential-corpus-v1.json`. Fixtures carry tags so compiler unit, conformance, fuzz regression, binding, and browser corpora can be connected incrementally without changing the report format.

The default artifacts are:

- `.cache/selfhost-differential/smoke/report.json` for machine processing;
- `.cache/selfhost-differential/smoke/summary.md` for review.

The JSON identifies the fixture and exact JSON path of every differing field.

## Expected divergence policy

An expected divergence belongs to one fixture and one exact report path. It must include:

- a non-empty reason;
- an ISO `YYYY-MM-DD` expiry date;
- the exact path, such as `$.runtime.returnValue`.

Expired policies fail before comparison. A policy that no longer matches any difference is stale and also fails, forcing its removal. Unexplained differences always fail. The harness never adds or approves a policy automatically.

## Runtime comparison

The Node executor writes emitted modules into an isolated directory under `.cache`, imports the entry module, awaits its public `main` function, and records a JSON-safe return value. Temporary paths are normalized from panic data, while program output and event order remain exact. Rejected compiler outputs are not executed.

## CI adoption

The smoke command is suitable for an initial non-blocking CI step:

```yaml
- name: Self-host differential smoke
  continue-on-error: true
  run: npm run selfhost:differential:smoke
```

The step must remain non-blocking until a real self-host kernel is connected and the promotion criteria in the self-hosting architecture are met. At that point the right-hand kernel changes; the corpus and artifact format remain unchanged.


## Parser parity corpus

The versioned `.github/self-hosting/parser-parity-corpus-v1.json` corpus compares the production Legacy lexer/parser with the Virune Stage 0 frontend. It covers the Virune 1.0 grammar families, compares accepted/rejected status, and compares the public parser diagnostic contract (`code`, `severity`, and source range) for isolated malformed cases. Chevrotain's historical inclusive `endOffset` is normalized at the Host boundary; line and column values remain unchanged. Deterministic bounded mutations verify progress, canonical arena IDs, and absence of panics.

Run it locally with:

```bash
npm run selfhost:parser:parity
```

Expected divergences require an exact case and JSON path, a reason, and a non-expired ISO date. Unmatched, stale, or expired policies fail the test.
