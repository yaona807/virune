# JavaScript Interop Third-Party Distribution Boundary

[日本語版](js-interop-distribution_ja.md)

This document defines the third-party license and redistribution boundary for the JavaScript / TypeScript interoperability model. It does not grant permission to use or redistribute any external package and does not classify package licenses as compiler safety evidence.

## Declaration analysis is semantic consumption

A JavaScript interop provider MAY read TypeScript declaration files, platform declarations, package metadata, and the declaration graph needed to resolve a concrete usage. Those inputs remain third-party material.

Stable provider-independent External / Foreign IR, reproducibility evidence intended for distribution, and generated Virune program output MUST contain semantic facts only. They MUST NOT serialize declaration-source bodies, declaration doc comments, mechanically reproduced declaration text, absolute declaration-source blobs, or live TypeScript compiler objects such as `ts.Type`, `ts.Symbol`, AST nodes, or `Program` instances.

Stable evidence MAY retain the minimum identifiers needed to reproduce or explain a resolution, including module and export/property names, canonical package-relative declaration locators, normalized type displays, package/provider identity and version, hashes, and module-resolution witness metadata.

## Generated JavaScript references dependencies

Ordinary Direct External Semantics MUST emit normal JavaScript imports and operations against the external runtime dependency. Virune MUST NOT make Direct interop work by copying the dependency implementation into generated application output.

Compiler-generated callable shims, bridge helpers, and other Virune-owned boundary machinery are Virune-generated code. They MUST NOT be derived by copying third-party declaration bodies, documentation, or runtime implementation bodies.

## Technical compatibility is not a license grant

Every external package keeps its own license terms. Users and distributors remain responsible for satisfying those terms for their intended use and distribution model.

Direct, Managed, Adapter, Host, or Unsafe classification describes a technical interoperability boundary only. It MUST NOT be represented as a legal or license classification, and dependency license category MUST NOT participate in TypeScript usage resolution, External operation selection, or Interop safety claims.

## Bundling is a separate distribution boundary

When a Virune distribution artifact actually bundles TypeScript or another third-party implementation, the repository's existing deterministic license / NOTICE / SBOM collection and release verification apply. Missing, conflicting, or otherwise unresolved bundled-package legal provenance MUST fail closed under those existing release policies.

External packages used only by a downstream Virune application are not silently reclassified as Virune-owned release contents.

## Persistent generated bindings require separate review

A future feature that persists or redistributes transformed declaration content, such as `.d.ts` to generated Virune binding source, is a separate distribution feature. It requires an explicit design and license review covering source provenance, copied comments/documentation, generated-file attribution, and redistribution obligations. It MUST NOT be introduced as an incidental implementation detail of Direct External Semantics.
