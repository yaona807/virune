# Bootstrap artifact snapshots

[English](self-hosting-bootstrap-snapshot.md) | [日本語](self-hosting-bootstrap-snapshot_ja.md)

The bootstrap artifact snapshot adapter connects an actual `buildProject` result to the versioned bootstrap artifact normalizer. It is a preparatory Stage 0 capability for later Stage 1／Stage 2 comparison; it does not generate a new compiler stage or change compiler selection.

## Captured data

For every emitted module, the snapshot records:

- repository-relative JavaScript output path;
- generated JavaScript with normalized line endings;
- parsed and canonicalized source map;
- the finite ES module export forms emitted by Virune;
- SHA-256 entries for JavaScript and source-map files.

The snapshot also records the diagnostic schema and explicit metadata:

- stage (`stage0`, `stage1`, or `stage2`);
- compiler version;
- language version and target platform;
- Runtime ABI and Interop ABI versions;
- optional fixed Seed SHA-256;
- source-map configuration.

`generatedAt` and `runId` remain the only versioned run metadata ignored by normalization. Other metadata differences remain visible.

## Safety conditions

Snapshot creation fails when:

- the project build contains an error diagnostic;
- no module was emitted;
- an emitted module has incomplete output metadata;
- a source map is not valid JSON;
- required version metadata is empty;
- a supplied Seed checksum is not SHA-256;
- generated export syntax is outside the finite forms produced by the emitter.

The adapter does not read the filesystem or execute generated JavaScript. It consumes the data already returned by `buildProject`.

## Determinism smoke

The focused test builds the self-host MVP twice with independent one-shot builds. Different run IDs and timestamps must normalize to the same serialized artifact and SHA-256. A meaningful JavaScript change must remain visible in both the module and checksum sections.

## Boundaries

This capability does not:

- generate Stage 1 or Stage 2;
- invoke a bootstrap compiler facade;
- enable shadow or required CI gates;
- change the production compiler default;
- alter the grammar, stable Compiler API, Runtime ABI, Interop ABI, or public standard library.
