# Bootstrap artifact normalization

Bootstrap determinism compares Stage 1 and Stage 2 only after applying a versioned, explicit normalization policy. This module establishes that policy before the Stage 1／2 driver is connected.

## Policy v1

The normalizer accepts generated JavaScript modules, source maps, module exports, the diagnostic schema, build metadata, and a checksum manifest.

It canonicalizes:

- repository-relative paths and path separators
- module, export, checksum, and JSON object ordering
- CRLF／CR line endings to LF in generated JavaScript
- source-map `file` and `sources` paths
- SHA-256 casing

Generated JavaScript content, source-map mappings and contents, exports, diagnostic schema fields, metadata, and checksum values otherwise remain significant.

## Explicit non-deterministic metadata

Policy v1 ignores only the top-level metadata fields:

- `generatedAt`
- `runId`

The normalized artifact records this allowlist in `policy.ignoredMetadataFields`. No unknown or nested field is silently removed. Adding or changing any other metadata field changes the normalized hash and appears in the field-level diff.

## Validation

The normalizer rejects unsupported policy versions, paths that escape the configured root, duplicate canonical module or checksum paths, duplicate exports, invalid SHA-256 values, undefined JSON fields, and non-finite JSON numbers.

It returns:

- canonical artifact data
- a stable serialized representation
- a SHA-256 digest
- section／field-level differences between two normalized artifacts

Focused validation:

```bash
npm run build
node --test packages/compiler/dist/test/selfhost-bootstrap-artifact-normalizer.test.js
```

This foundation does not generate Stage 1 or Stage 2, alter existing release gates, enable required shadow execution, or switch the Production compiler.
