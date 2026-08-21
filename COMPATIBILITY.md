# Compatibility policy

日本語: [COMPATIBILITY_ja.md](COMPATIBILITY_ja.md)

This document defines the compatibility guarantees for stable Virune releases and the rules for incompatible changes.

## Compatibility classes

Virune divides exposed surfaces into three classes:

- **Stable**: public contracts preserved across stable releases
- **Experimental**: public surfaces under evaluation with no stable compatibility guarantee
- **Internal**: implementation details outside compatibility guarantees

### Stable

A surface is Stable only when that status is explicit. A version number, versioned path, or snapshot does not make a surface Stable by itself.

Stable contracts include the normative Language Specification and public APIs, ABIs, configuration, and machine-readable formats that are explicitly declared Stable. Use each contract's canonical source to determine its exact surface.

Additions and fixes are allowed when they preserve existing use. Intentional incompatible changes belong in a major release except for the exceptions below.

### Experimental

Experimental surfaces are outside the stable compatibility guarantee. They may change or be removed in any release as evaluation continues.

Using an Experimental surface does not weaken guarantees for unrelated Stable contracts.

### Internal

Compiler internals, self-hosting implementation details, caches, CI data, repository-only commands, and unpublished package subpaths are Internal.

Internal details may change without prior deprecation as long as Stable contracts remain intact.

## Versions and incompatible changes

Stable releases follow Semantic Versioning.

- **Patch**: backward-compatible fixes
- **Minor**: additions and improvements that preserve existing contracts
- **Major**: intentional incompatible changes to Stable contracts

Prereleases may contain incompatible changes. Nightly builds have no compatibility guarantee.

The following are incompatible changes when they affect a Stable surface:

- removing, renaming, or incompatibly changing public APIs, ABIs, standard-library entries, CLI behavior, or editor integration
- rejecting previously valid public configuration or incompatibly changing its meaning or defaults
- preventing a previously conforming Virune program from parsing, type-checking, linking, or running, or incompatibly changing its meaning
- incompatibly changing Stable diagnostics or machine-readable formats
- raising a minimum supported version and dropping an environment that was previously supported

Human-facing wording, colors, layout, unpublished settings, and internal formats are not compatibility guarantees unless explicitly declared Stable.

## Deprecation

Before removing or incompatibly changing a Stable contract, Virune normally follows this sequence:

1. Mark the contract as deprecated.
2. Provide a replacement or migration path.
3. Publish at least one stable release that still supports the old contract while marking it deprecated.
4. Make the incompatible change in a major release and provide the required migration guidance.

Experimental and Internal surfaces do not require this process.

Deprecation must not weaken type, safety, ABI, or validation boundaries, and marking a contract deprecated must not by itself change the meaning of existing programs.

## Correctness, safety, and security exception

Virune must not preserve behavior known to violate the normative specification solely for compatibility.

For a material correctness, safety, or security problem, prefer a backward-compatible fix when one is reasonably possible. An incompatible fix may land before the next major release only when no reasonable backward-compatible fix exists and leaving the problem unresolved would be worse.

The same rule applies when a previously supported environment can no longer be maintained safely or practically.

An exceptional incompatible change must identify at least:

- the affected Stable contract
- the previous behavior
- why a backward-compatible fix is not possible
- available mitigation or migration steps

Do not expand the exception to unrelated Stable contracts.

## When canonical sources disagree

[`spec/`](spec/README.md) is normative for language behavior. Other public contracts are governed by their respective public APIs, ABIs, schemas, and machine-readable policies.

If the specification, implementation, tests, or snapshots disagree, do not choose the most convenient interpretation. Resolve the inconsistency before treating the behavior as a Stable guarantee.

A snapshot update or green CI alone does not authorize an incompatible change.
