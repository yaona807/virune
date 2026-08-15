# Compatibility and deprecation policy

[English](compatibility-policy.md) | [日本語](compatibility-policy_ja.md)

This document defines the compatibility contract for stable Virune releases. It coordinates the existing language specification, versioned Runtime and Interop ABIs, public Compiler API, standard library, CLI, editor integration, and self-hosting recovery artifacts without weakening their more specific rules.

## Compatibility classes

Virune surfaces are classified as **Stable**, **Experimental**, or **Internal**.

### Stable

Stable surfaces are compatibility commitments for users of stable releases:

- the normative Virune language behavior under [`../spec/`](../spec/)
- the documented public standard-library surface tracked by `packages/public-abi.snapshot.json`
- the root `@virune/compiler` API tracked by `packages/compiler/api/stable-api.snapshot.json`
- versioned Runtime ABI and Interop ABI surfaces
- documented public CLI commands, options, and exit-code meanings
- the stable diagnostic-code and JSON-schema contract documented in [`diagnostic-codes.md`](diagnostic-codes.md)
- other explicitly documented stable machine-readable schemas and fields
- documented Virune-owned VS Code settings and public extension command identifiers, when such identifiers are documented

A stable surface may grow compatibly in a minor release and may receive compatible corrections in a patch release. An intentional incompatible change to a stable contract normally requires the next major release.

### Experimental

Experimental surfaces are available for evaluation but are not covered by stable compatibility guarantees. They may change or be removed in any release, although material changes should still be called out in release notes when users are likely to be affected.

Current examples include:

- `@virune/compiler/experimental`
- Semantic Snapshot / Semantic Change Evidence schemas while the prototype and corpus evaluation in #213 are incomplete
- other APIs or schemas explicitly marked experimental or prerelease-only

Using an experimental surface does not make unrelated stable surfaces experimental.

### Internal

Internal implementation details are not public compatibility contracts. Examples include compiler AST/HIR/MIR structures, symbol and type arenas, lowering phases, self-hosting implementation details, caches, CI metadata, repository-only commands, and undocumented package subpaths.

Internal changes may be made without deprecation as long as they preserve all applicable stable contracts.

## Stable release versioning

Stable Virune releases use Semantic Versioning as the project-level compatibility signal.

- **Patch** (for example, `1.0.0` -> `1.0.1`): backward-compatible corrections. A conforming program or supported stable consumer should not require migration solely because of an intentional stable-contract change.
- **Minor** (for example, `1.0.x` -> `1.1.0`): backward-compatible additions and improvements. Existing conforming programs and stable consumers remain supported.
- **Major** (for example, `1.x.y` -> `2.0.0`): may intentionally change stable contracts and therefore requires explicit migration documentation for affected surfaces.

Prerelease and nightly compatibility remain governed by [`release-channels.md`](release-channels.md): prereleases may change incompatibly between prerelease builds, and nightly snapshots have no compatibility guarantee.

## Language compatibility

The files in [`../spec/`](../spec/) are the normative language contract. Editorial clarifications that do not change observable behavior do not require a major release.

An intentional change is language-breaking when a previously conforming program can no longer be parsed, type-checked, linked, or evaluated according to the normative contract, or when the observable meaning of such a program changes incompatibly.

Source-compatible additive syntax or semantics may ship in a minor release only when existing conforming programs retain their prior meaning.

A compiler fix that restores behavior required by the existing normative specification is a correctness fix rather than a redefinition of the language contract. If the repair itself is incompatible with a Stable surface, it must either wait for the next major release or satisfy the exceptional correctness, safety, and security fix rules below. If such a fix creates material migration work for code that depended on the incorrect implementation, release notes must identify the affected behavior and provide migration guidance.

## Runtime ABI, Interop ABI, Compiler API, and standard library

Runtime and Interop ABIs use versioned paths and snapshots. The current ABI-specific rules remain authoritative in [`runtime-abi.md`](runtime-abi.md). A breaking ABI change requires a new versioned ABI path and migration documentation; updating a snapshot alone does not make a breaking change compatible.

The stable `@virune/compiler` root entry point follows [`compiler-api.md`](compiler-api.md). Removing, renaming, or incompatibly changing a stable exported symbol is breaking. `@virune/compiler/experimental` remains outside this guarantee.

The documented public standard-library declarations and export map are stable. Removing or incompatibly changing an existing public declaration or package entry point is breaking. Additive APIs may ship in a minor release when they do not change existing program meaning.

## CLI and machine-readable output

The following documented CLI behavior is stable unless explicitly marked otherwise:

- command and option names
- documented exit-code meanings
- the diagnostic code, severity, coordinate, and JSON schema guarantees in [`diagnostic-codes.md`](diagnostic-codes.md)
- other explicitly documented stable machine-readable schema versions and fields

Human-oriented presentation is not a byte-stable interface. Wording, whitespace, color, wrapping, and similar presentation details may change when the documented meaning is preserved.

A mode being JSON does not automatically make every emitted field a stable contract. A JSON field or structure becomes stable only when Virune explicitly documents it as a stable machine-readable schema or field. Consumers that depend on undocumented fields must treat them as experimental/internal details.

## LSP and VS Code compatibility

Virune follows its declared VS Code API baseline and the upstream Language Server Protocol for protocol-level interoperability. Documented Virune-owned VS Code setting keys are Stable. A public extension command identifier is Stable when the identifier itself, rather than only its display label, is documented as part of the public interface. Undocumented Virune-specific LSP extensions or wire details are not implicitly Stable.

Internal indexing, caching, scheduling, request implementation, and analysis storage are not compatibility contracts. Raising the minimum supported VS Code API baseline in a way that drops a previously supported stable environment is treated like a platform-baseline breaking change unless an exception below applies.

## Node.js baseline

The root `engines.node` value is the minimum supported Node.js baseline for the stable toolchain. Raising that minimum so that a previously supported Node.js environment is no longer supported is an intentional compatibility break and normally belongs in the next major Virune release.

A platform end-of-life, security requirement, or other condition that makes the previous baseline unsafe or unsupportable may require an earlier change under the exceptional-fix rules below. The release must state the old and new baselines and the reason.

## Deprecation procedure

Before intentionally removing or incompatibly changing a stable surface, Virune should use this sequence:

1. Mark the old surface deprecated in the relevant public documentation and, where practical, tooling or type metadata.
2. Document the supported replacement or migration path.
3. Publish at least one stable release that carries the deprecation while keeping the old surface available before the release that removes it, unless the exceptional-fix rules apply.
4. Remove or incompatibly change it only in a major release.
5. Include the breaking change and migration steps in that major release's release notes or migration guide.

Deprecation warnings must not silently change program semantics. Deprecation is a migration signal, not permission to weaken type, safety, ABI, or validation boundaries.

Experimental and Internal surfaces do not require this deprecation period.

## Exceptional correctness, safety, and security fixes

Compatibility must not be preserved by keeping behavior that is known to violate the normative specification, a safety boundary, or a security requirement.

When a backward-compatible repair is reasonably possible, use it. If preserving compatibility would keep a material correctness, safety, or security defect and no compatible repair is reasonably available, an exceptional fix may land before the next major release. Such a release must:

- state that an exceptional compatibility break exists
- identify the affected stable surface and prior behavior
- explain why the compatible alternative was not acceptable
- provide mitigation or migration guidance
- preserve all unrelated stable contracts

An exception is not a general mechanism for bypassing Semantic Versioning or compatibility review.

## Migration guide trigger

Every intentional breaking change to a Stable surface must have migration guidance before the corresponding stable release. Guidance should identify the affected versions and surface, describe the old and new contract, and provide concrete migration steps or examples where applicable.

Multiple related breaking changes may share one migration document, but an affected surface must not be omitted merely because CI or snapshots are green.

## Self-hosting Legacy Compiler and fixed Seed retention

Self-hosting recovery artifacts use lifecycle conditions rather than a fixed calendar retention window.

- The fixed Stage 0 Seed remains an immutable trust root until it is explicitly replaced through the dedicated Seed update policy in [`self-hosting-seed.md`](self-hosting-seed.md).
- The Legacy Compiler remains available for as long as the current self-hosting promotion and rollback policy requires a verified fallback path.
- Successful self-host CI alone is not authorization to delete the Seed or Legacy rollback path.
- Replacing the Seed or retiring the Legacy Compiler requires its own reviewed migration/evidence and must not silently change the Language Specification, stable Compiler API, Runtime ABI, Interop ABI, or public standard library.

## Sources of truth

Compatibility decisions use the following authorities:

1. **Language semantics**: [`../spec/`](../spec/) is normative. Explanatory documentation and implementation must conform to it.
2. **Public ABI and API inventory**: committed ABI/API snapshots mechanically identify reviewed public surfaces. Snapshot updates require review, but a snapshot update does not by itself authorize a breaking change.
3. **Surface-specific documentation**: Runtime/Interop ABI, Compiler API, diagnostics/JSON, CLI, VS Code, release-channel, and self-hosting documents define the detailed contract and lifecycle of their respective surfaces.
4. **Release notes and migration guides**: describe what changed in a particular release and how to migrate. They do not silently override the normative specification or this policy.
5. **Implementation and tests**: demonstrate conformance and detect regressions; they do not redefine a conflicting normative contract merely by passing.

When two authorities appear inconsistent, do not infer the more permissive interpretation. Resolve the inconsistency explicitly in the relevant specification/policy and its tests before treating the behavior as a stable guarantee.

## Non-goals

This policy does not:

- freeze Experimental or Internal implementation details
- guarantee byte-for-byte human CLI output
- make undocumented JSON fields stable
- promise indefinite support for old major release lines
- weaken security, correctness, ABI, reproducibility, or self-hosting promotion gates in order to preserve compatibility
- treat a green snapshot/CI update as proof that an incompatible change is acceptable

See also [`release-channels.md`](release-channels.md), [`compiler-api.md`](compiler-api.md), [`runtime-abi.md`](runtime-abi.md), [`diagnostic-codes.md`](diagnostic-codes.md), and the normative [`../spec/`](../spec/).
