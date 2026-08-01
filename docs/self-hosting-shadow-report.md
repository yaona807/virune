# Self-hosting shadow reports

[English](self-hosting-shadow-report.md) | [日本語](self-hosting-shadow-report_ja.md)

The bootstrap shadow report converts two normalized bootstrap artifacts into deterministic, uploadable evidence. It is designed for later Nightly shadow execution and is deliberately non-blocking in version 1.

## Comparison contract

A report contains:

- explicit baseline and candidate labels, stages, compiler versions, and artifact SHA-256 values;
- the raw normalized-artifact equality result;
- expected differences;
- unexpected differences with complete section and field paths;
- a section-level count summary;
- deterministic JSON serialization and a report SHA-256.

The only expected artifact difference is `metadata.stage`, and it is accepted only when the values exactly match the declared baseline and candidate stages. No generated JavaScript, source map, module order, exports, diagnostic schema, ABI metadata, checksum, or other metadata difference is ignored.

## Status

- `equivalent`: no unexpected differences exist. The raw artifacts may still differ at `metadata.stage`.
- `mismatch`: one or more unexpected differences exist.

`blocking` is always `false` in report version 1. A report is evidence, not a branch-protection decision and not permission to switch the production compiler.

## Integrity and determinism

The reporter verifies that each supplied artifact SHA-256 matches its serialized content and that the structured artifact matches the serialization. Malformed or tampered inputs fail closed.

All changes are sorted by section, field path, before value, and after value. Section summaries are sorted by section name. Identical inputs therefore produce byte-identical report JSON and SHA-256 values.

## Current boundary

This capability does not run Stage 1 or Stage 2, modify Nightly workflows, create a required gate, change branch protection, change compiler selection, update the fixed Seed, or alter the stable Compiler API, Runtime ABI, Interop ABI, grammar, or public standard library.
