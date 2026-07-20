# Fuzzing

Virune combines deterministic regression fuzz tests with a long-running nightly property suite.

## Invariants

The long suite verifies:

- lexer, parser, checker, compiler, and formatter do not throw for arbitrary input;
- diagnostic spans are finite, ordered, and inside the source file;
- repeated compilation returns the same diagnostics and output;
- formatting parseable input remains parseable;
- formatting is idempotent;
- comment token order and text are preserved.

## Local execution

```bash
npm run test:fuzz:smoke
VIRUNE_FUZZ_DURATION_MS=900000 VIRUNE_FUZZ_SHARD=0 npm run test:fuzz:long
```

The generator is seeded and deterministic. Set `VIRUNE_FUZZ_SEED` to replay a specific stream.

## Failure handling

A failure writes the source and JSON metadata to `fuzz-regressions/artifacts/`. Nightly CI always uploads that directory. Reviewed failures must be minimized and moved into deterministic package fixtures before being considered resolved.

The repository contains the infrastructure and deterministic regression corpus. Historical long-run evidence begins accumulating only after the scheduled workflow runs; it is not inferred from the presence of the workflow itself.
