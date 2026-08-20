# Compatibility and deprecation policy

[English](compatibility-policy.md) | [日本語](compatibility-policy_ja.md)

This document defines the compatibility commitments maintained by stable Virune releases. Detailed rules for individual APIs, ABIs, diagnostics, releases, self-hosting, and other surfaces are defined in their dedicated documents.

## Compatibility classes

Virune surfaces are classified as **Stable**, **Experimental**, or **Internal**.

### Stable

Stable surfaces are public contracts maintained for users of stable releases. They include:

- normative Virune language behavior defined by [`../spec/`](../spec/)
- documented `virune.json` settings, accepted stable values, meanings, and defaults
- documented public standard-library declarations and export map, plus the public symbols and documented behavior of the root `@virune/compiler` API
- Runtime ABI and Interop ABI versions explicitly declared Stable
- documented public CLI commands and options and their meanings, plus documented exit-code meanings
- the diagnostic-code and JSON-schema contract in [`diagnostic-codes.md`](diagnostic-codes.md), plus other machine-readable schemas or fields explicitly declared Stable
- Virune LSP / VS Code capabilities documented for stable releases, Virune-owned setting keys with their accepted stable values, meanings, and defaults, and extension command identifiers when the identifier itself is documented as part of the public interface
- platform baselines supported by stable releases, such as the root `engines.node` requirement and the declared VS Code API baseline

Stable surfaces may receive additions or corrections that preserve existing user-visible meaning. Intentional incompatible changes require a major release unless the exception below applies.

A version number, versioned path, or snapshot does not by itself make a surface Stable. Stabilization must be explicit. API and ABI snapshots mechanically track reviewed public surfaces; updating a snapshot does not by itself authorize an incompatible change or make one compatible.

### Experimental

Experimental surfaces are public surfaces under evaluation and are not covered by stable compatibility guarantees. Surfaces explicitly marked Experimental or prerelease-only, such as `@virune/compiler/experimental`, may change or be removed in any release.

Semantic Snapshot and Semantic Change Evidence schemas remain Experimental until they are explicitly stabilized after the prototype and corpus evaluation required by #213. Completing that evaluation does not by itself make them Stable. Material changes that are likely to affect users should be called out in release notes.

Using an Experimental surface does not make unrelated Stable surfaces Experimental.

### Internal

Internal details are not public compatibility contracts. Examples include compiler internals, self-hosting implementation details, caches, CI metadata, repository-only commands, and undocumented package subpaths.

Internal details may change without deprecation as long as all Stable public contracts remain intact.

## Versioning and breaking changes

Stable releases use Semantic Versioning.

- **Patch** (for example, `1.0.0` -> `1.0.1`): backward-compatible corrections
- **Minor** (for example, `1.0.x` -> `1.1.0`): additions and improvements that preserve existing Stable meaning
- **Major** (for example, `1.x.y` -> `2.0.0`): intentional incompatible changes to Stable surfaces; migration guidance is required for affected users

Prereleases may contain incompatible changes, and nightlies have no compatibility guarantee. See [`release-channels.md`](release-channels.md). Editorial changes to the normative specification that do not change externally observable behavior are not breaking changes.

For Stable public contracts, breaking changes include, for example:

- removing or renaming a public API, ABI, standard-library entry, CLI surface, or editor capability, changing a signature incompatibly, or incompatibly changing documented behavior
- rejecting a previously valid documented setting or value, or incompatibly changing its meaning or default
- causing a previously conforming Virune program to stop parsing, type-checking, linking, or evaluating according to the normative specification, or incompatibly changing its externally observable meaning
- incompatibly changing the meaning or structure of a Stable diagnostic or machine-readable schema
- raising a minimum supported Node.js, VS Code, or other platform baseline so that a previously supported environment is no longer supported

If platform end-of-life, a security requirement, or another condition makes the previous baseline unsafe or impractical to support, it may change before the next major release under the exception below. The release must state the old and new baselines and the reason for the change.

Human-oriented wording, whitespace, color, layout, and similar presentation are not byte-level compatibility contracts unless explicitly documented as such. Undocumented JSON fields, settings, editor details, and protocol details do not become Stable merely because they happen to be usable.

Completion ranking, UI layout, internal indexing, caches, scheduling, request implementation, and analysis storage are also outside the Stable contract unless explicitly defined otherwise.

## Deprecation

Before intentionally removing or incompatibly changing a Stable surface, Virune follows this sequence unless the exception below applies:

1. Mark the old surface deprecated in public documentation and, where practical, in tooling or type metadata.
2. Document the replacement or migration path.
3. Publish at least one stable release that includes the deprecation while keeping the old surface available.
4. Remove or incompatibly change the surface in a major release, and document the change and migration path in release notes or a migration guide.

Migration guidance must be available before the corresponding stable release and identify the affected versions and surface and the old and new contracts. It should include concrete migration steps or examples where applicable.

Experimental and Internal surfaces do not require this deprecation period. Deprecation does not justify weakening type, safety, ABI, or validation boundaries, and marking a surface deprecated must not by itself change existing program meaning.

## Correctness, safety, and security exception

Virune must not preserve behavior known to violate the normative specification, a safety boundary, or a security requirement solely for compatibility.

When a backward-compatible repair is reasonably possible, use it. An incompatible fix before the next major release is allowed only when a material correctness, safety, or security defect would otherwise remain, or when platform end-of-life makes the previous baseline unsafe or impractical to support, and no reasonable compatible repair exists.

Such a release must state that an exceptional compatibility break exists, identify the affected Stable surface and prior behavior, explain why a compatible repair was not acceptable, provide mitigation or migration guidance, and preserve unrelated Stable contracts.

A compiler fix that restores behavior required by the existing normative specification is a correctness fix rather than a language-contract change. If that repair is incompatible with a Stable surface, it must satisfy this exception or wait for the next major release. If code that depended on the incorrect implementation requires migration, release notes must identify the impact and migration path.

This exception is not a general way to bypass Semantic Versioning or compatibility review.

## Detailed contracts

See the dedicated contracts for each surface:

- Language: [`../spec/`](../spec/)
- Compiler API: [`compiler-api.md`](compiler-api.md)
- Runtime / Interop ABI: [`runtime-abi.md`](runtime-abi.md)
- Diagnostics / JSON schema: [`diagnostic-codes.md`](diagnostic-codes.md)
- Release channels: [`release-channels.md`](release-channels.md)
- Self-hosting: [`self-hosting-architecture.md`](self-hosting-architecture.md), [`self-hosting-seed.md`](self-hosting-seed.md)

Self-hosting recovery-artifact retention and removal follow their dedicated lifecycle policies. Successful self-host CI alone is not authorization to remove the Seed or Legacy rollback path.

If the specification, policy, implementation, and tests disagree, do not guess the more permissive interpretation. Reconcile the applicable contract and tests before treating the behavior as a Stable guarantee. Release notes and migration guides do not silently override the normative specification or this policy, and green CI or snapshots alone do not authorize an incompatible change.

This policy does not promise indefinite support for old major releases and does not weaken correctness, safety, security, ABI, reproducibility, or self-hosting gates in order to preserve compatibility.
