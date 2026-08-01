# Self-hosting source manifest

This document defines the version 1 source manifest used by the experimental self-hosting Host–Kernel boundary.

## Purpose

A Host receives source files from a filesystem, editor, archive, or another environment. Before the Compiler Kernel or Interop resolution evidence can depend on those files, the Host needs one deterministic identity for the exact source set.

`createKernelSourceManifest` converts a validated `KernelInputV1` into a data-only manifest and a project-level SHA-256. The manifest contains no source text and no host objects.

## Canonicalization

The implementation:

1. validates the input through the existing Kernel contract;
2. uses canonical project-relative paths from that contract;
3. normalizes CRLF and CR line endings to LF for hashing and byte counts;
4. preserves all other source bytes, including Unicode and trailing whitespace;
5. sorts source entries by canonical path;
6. records each source SHA-256, normalized UTF-8 byte length, and line count;
7. serializes the fixed version 1 shape with `JSON.stringify`;
8. computes the project-level SHA-256 from that serialization.

Equivalent source ordering, path separators, and line-ending conventions therefore produce the same manifest. A meaningful source change changes the affected source hash and the project-level hash.

## Version 1 shape

```json
{
  "version": "1",
  "contractVersion": "1",
  "languageVersion": "1.0",
  "platform": "node",
  "entryPath": "src/main.virune",
  "sources": [
    {
      "path": "src/main.virune",
      "sourceSha256": "<lowercase sha256>",
      "utf8ByteLength": 42,
      "lineCount": 3
    }
  ]
}
```

The project-level SHA-256 is returned next to the manifest as `KernelSourceManifestResultV1.sha256`; it is not embedded recursively inside the manifest.

## Validation and verification

- `validateKernelSourceManifest` rejects unsupported versions, unknown or missing properties, non-canonical paths, unsorted or duplicate entries, malformed hashes, invalid counts, and an entry path absent from the source set.
- `verifyKernelSourceManifest` additionally compares every binding and source field against a canonical manifest rebuilt from the supplied Kernel input. It can also require an expected project-level SHA-256.

Validation is fail-closed. Non-canonical data is not silently reordered or repaired.

## Boundaries

This slice does not read the filesystem, resolve packages, parse Virune, type-check source, emit JavaScript, or modify the production compiler. It is an experimental data contract used to make later self-hosting stages reproducible.
