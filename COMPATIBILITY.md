# Compatibility and deprecation policy

[日本語](COMPATIBILITY_ja.md)

This document defines the compatibility guarantees for stable Virune releases.

## Compatibility classes

Virune uses three compatibility classes:

- **Stable**: public contracts preserved across stable releases
- **Experimental**: public surfaces under evaluation with no stable compatibility guarantee
- **Internal**: implementation details outside compatibility guarantees

### Stable

The main Stable surfaces include:

- Virune language behavior defined by the [language specification](spec/)
- documented `virune.json` configuration
- documented public standard-library declarations and the `exports` configuration in `package.json`
- the root public `@virune/compiler` API
- Runtime ABI and Interop ABI versions explicitly declared Stable
- documented CLI behavior
- the public contract defined by diagnostic codes and JSON format, plus other machine-readable formats explicitly declared Stable
- public LSP / VS Code capabilities, settings, and commands documented for stable releases
- environments declared supported by stable releases, such as Node.js and VS Code

Additions and fixes may be made when they preserve existing use.
Intentional incompatible changes require a major release unless the exception below applies.

A version number, versioned path, or snapshot does not by itself make a surface Stable.
Stabilization must be explicit, and updating a snapshot alone does not authorize an incompatible change.

LSP follows the VS Code API versions supported by Virune and the Language Server Protocol.

### Experimental

Experimental surfaces are not covered by stable compatibility guarantees and may change or be removed in any release.

`@virune/compiler/experimental` is Experimental.

Semantic Snapshot and Semantic Change Evidence remain Experimental until the required evaluation is complete and they are explicitly stabilized.
Completing evaluation alone does not make them Stable.

Using an Experimental surface does not affect guarantees for unrelated Stable surfaces.

### Internal

Compiler internals, self-hosting implementation details, caches, CI data, repository-only commands, and undocumented package subpaths are Internal.

Internal details may change without deprecation as long as Stable public contracts are preserved.

## Versioning and incompatible changes

Stable releases use Semantic Versioning.

- **Patch**: backward-compatible fixes
- **Minor**: additions and improvements that preserve existing behavior
- **Major**: intentional incompatible changes to Stable contracts

Prereleases may contain incompatible changes.
Nightlies have no compatibility guarantee.

Examples of incompatible changes include:

- removing, renaming, or incompatibly changing public APIs, ABIs, standard-library entries, CLI, or editor capabilities
- rejecting previously valid documented configuration, or incompatibly changing its meaning or default
- preventing a previously conforming Virune program from being parsed, type-checked, linked, or evaluated, or incompatibly changing its meaning
- incompatibly changing Stable diagnostics or machine-readable formats
- raising a minimum supported version and dropping a previously supported environment

Human-oriented presentation such as wording, color, and layout, and undocumented settings, JSON fields, or internal details are not Stable unless explicitly guaranteed.

## Deprecation

Before removing or incompatibly changing a Stable contract, Virune normally follows this sequence:

1. Mark it deprecated in public documentation and, where practical, in tooling or type metadata.
2. Provide a supported replacement or migration path.
3. Publish at least one stable release that keeps the old contract available while marking it deprecated.
4. Make the change in a major release and provide migration guidance.

Migration guidance is prepared before release and identifies the affected versions and surface, the old and new contracts, and the required migration steps.

Experimental and Internal surfaces do not require this process.
Deprecation does not justify weakening type, safety, ABI, or validation boundaries, and marking a surface deprecated must not by itself change existing program meaning.

## Correctness, safety, and security exception

Virune must not preserve behavior known to violate the normative specification solely for compatibility.

For material correctness, safety, or security problems, a backward-compatible fix is preferred when reasonably possible.
Only when no reasonable backward-compatible fix exists and the problem would otherwise remain may an incompatible fix land before the next major release.

The same applies when platform support ends and an existing environment can no longer be supported safely or practically.

An exceptional incompatible change must identify the affected Stable contract, the previous behavior, why a backward-compatible fix is not possible, and any mitigation or migration path, while preserving unrelated Stable contracts.

A fix that restores behavior required by the existing language specification is not a language-specification change.
If that fix is incompatible with a Stable contract, it must satisfy this exception or wait for the next major release.

This exception must not be used to bypass the normal compatibility rules.

If the specification, policy, implementation, and tests disagree, do not guess the more convenient interpretation.
Resolve the inconsistency before treating the behavior as a Stable guarantee.
Release notes or migration guidance alone cannot override the language specification or this policy.

Green CI or snapshots alone do not authorize an incompatible change.
