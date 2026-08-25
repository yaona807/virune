# Virune compatibility policy

[Japanese version](COMPATIBILITY_ja.md)

Virune aims to avoid breaking code and tools simply because a user upgrades to a newer stable release.

At the same time, not every experimental feature or internal implementation detail carries the same compatibility guarantee.

This document defines which parts of Virune are kept compatible and what kinds of changes are treated as incompatible changes.

## Three compatibility classes

Virune uses three compatibility classes:

- **Stable**: preserved across stable releases
- **Experimental**: still under evaluation and may change or be removed
- **Internal**: used only inside Virune and not covered by compatibility guarantees

When making a change, first identify which class the affected surface belongs to.

## Stable surfaces

Stable surfaces are intended to keep existing uses working when users upgrade Virune.

The main Stable surfaces include:

- Virune syntax and behavior defined by the [Language Specification](spec/README.md)
- documented `virune.json` configuration
- documented public standard-library declarations and the `exports` configuration in `package.json`
- the root public Compiler API exported from `@virune/compiler`
- Runtime ABI and Interop ABI versions explicitly declared Stable
- documented CLI commands and behavior
- public diagnostic codes and JSON formats, plus other machine-readable formats explicitly declared Stable
- Language Server and VS Code extension capabilities, settings, and commands documented for stable releases
- environments declared supported, such as Node.js and VS Code

Additions and fixes are allowed when they preserve existing use.

Changes that make an existing use stop working require a major release unless the exception below applies.

The Language Server follows the VS Code API versions supported by Virune and the Language Server Protocol.

### What counts as Stable

A public surface does not automatically become Stable merely because it exists.

For example, a version number, versioned path, or snapshot file does not by itself make a surface part of the compatibility guarantee.

Stable surfaces are explicitly identified through the Language Specification, public APIs, documented configuration, or this compatibility policy.

A surface explicitly marked Experimental is not Stable even if it is publicly accessible.

Updating a snapshot alone does not authorize an incompatible change.

If the classification is unclear, check how the surface is documented for users before changing it.

### Diagnostic codes

Published `Lxxxx` diagnostic codes may be used by external tools to identify error conditions.

For that reason, an existing diagnostic code must not later be reused for a different semantic condition.

Diagnostic message wording may improve over time. External tools should identify diagnostics by `source` plus `code`, or by `qualifiedCode`, rather than by message text.

The current diagnostic codes and machine-readable structures are defined by the compiler-owned diagnostic definitions and related schemas.

## Experimental surfaces

Experimental surfaces are still being evaluated for future stabilization.

They may change or be removed in any release, even when they are included in a stable Virune release.

Current examples include:

- `@virune/compiler/experimental`
- `Semantic Snapshot`, which captures semantic analysis results
- `Semantic Change Evidence`, which describes changes to those results

Completing evaluation alone does not make these surfaces Stable. They become covered by compatibility guarantees only when they are explicitly stabilized.

Using an Experimental surface does not remove compatibility guarantees from unrelated Stable surfaces.

## Internal implementation

Virune-internal implementation details are outside compatibility guarantees.

Examples include:

- compiler-internal data structures
- Self-hosting implementation details
- caches
- CI-only data
- repository-only commands
- package-internal files that are not exported through `package.json` `exports`

These may change without a user-facing deprecation period as long as Stable surfaces keep working.

## What counts as an incompatible change

Stable Virune releases follow Semantic Versioning.

- **Patch**: fixes that preserve existing use
- **Minor**: additions and improvements that preserve existing use
- **Major**: intentional incompatible changes to Stable surfaces

Examples of incompatible changes include:

- removing, renaming, or incompatibly changing public APIs
- incompatibly changing how generated JavaScript connects to the Runtime
- incompatibly changing how values cross the Virune / JavaScript boundary
- removing, renaming, or incompatibly changing existing standard-library APIs
- removing, renaming, or incompatibly changing documented CLI commands or behavior
- incompatibly changing public Language Server or VS Code extension capabilities, settings, or commands
- removing a documented `virune.json` setting, or incompatibly changing its meaning or default
- preventing a previously conforming Virune program from being parsed, type-checked, linked, or evaluated, or incompatibly changing its meaning
- incompatibly changing Stable diagnostic codes or machine-readable formats
- raising a minimum supported version and dropping an environment that was previously supported

The connection rules between generated code and the Runtime are called the Runtime ABI. The connection rules used for Virune / JavaScript interop are called the Interop ABI.

Prereleases may contain incompatible changes while a release is still being prepared.

Nightly builds are development snapshots and do not carry compatibility guarantees between builds.

Human-facing presentation such as wording, color, and layout, plus undocumented settings, JSON fields, and internal implementation details, are not Stable unless explicitly guaranteed.

## Deprecating a feature

When a Stable feature will eventually be removed or changed incompatibly, Virune normally avoids making it disappear without warning.

The usual sequence is:

1. Mark the feature deprecated in public documentation and, where practical, in tooling or type metadata.
2. Provide a supported replacement or migration path.
3. Publish at least one stable release where the old feature still works but is marked deprecated.
4. Remove or incompatibly change the old feature in a major release and provide migration guidance.

Migration guidance is prepared before release and identifies the affected versions and surface, the old and new contracts, and the required migration steps.

Experimental and Internal surfaces do not require this process.

Deprecation does not justify weakening type, safety, ABI, or validation boundaries. Marking a feature deprecated must not by itself change the meaning of existing programs.

## When correctness, safety, or security takes priority

Compatibility is important, but it is not a reason to preserve behavior that is known to be incorrect or unsafe.

For example, if implementation behavior is found to disagree with the [Language Specification](spec/README.md), Virune does not preserve the incorrect behavior solely because it existed before.

For material correctness, safety, or security problems, a backward-compatible fix is preferred whenever reasonably possible.

If no reasonable backward-compatible fix exists and leaving the issue unfixed would preserve the problem, an incompatible fix may land before the next major release.

The same applies when an external platform such as Node.js reaches end of support and an existing environment can no longer be maintained safely or practically.

An exceptional incompatible change must explain at least:

- which Stable contract is affected
- how it behaved before
- why the issue cannot reasonably be fixed while preserving compatibility
- what mitigation or migration path is available

Unrelated Stable surfaces should remain unchanged.

Fixing an implementation so that it restores behavior required by the existing Language Specification is not itself a Language Specification change. If that fix is incompatible for Stable users, it must satisfy this exception or wait for the next major release.

This exception is not a way to accelerate ordinary incompatible changes.

## When specification and implementation disagree

If the Language Specification, compatibility policy, implementation, and tests disagree, do not choose whichever interpretation is most convenient. Resolve the inconsistency before treating the behavior as a Stable guarantee.

Release notes or migration guidance alone cannot override the [Language Specification](spec/README.md) or this compatibility policy.

Green CI or snapshot checks alone do not make an incompatible change acceptable.

## If you are unsure

A practical rule is:

If a change may break a surface published as Stable, review its compatibility impact.

Experimental surfaces may change, but existing users should still receive appropriate guidance when needed.

For Internal changes, verify that no Stable behavior is affected.

If you cannot tell which class applies, discuss the change in an Issue before implementation.

For development workflow and validation guidance, see the [contribution guide](CONTRIBUTING.md).
