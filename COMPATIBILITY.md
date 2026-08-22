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

The main Stable public contracts currently include:

- the normative Language Specification under [`spec/`](spec/README.md)
- documented `virune.json` configuration
- public standard-library declarations and `package.json` `exports`
- the Stable Compiler API exported from the `@virune/compiler` root
- Runtime ABI and Interop ABI surfaces explicitly declared Stable
- published CLI contracts such as commands, options, and exit status
- diagnostics, JSON formats, and other machine-readable formats explicitly declared Stable
- Language Server and VS Code features, settings, and commands published for stable releases
- supported environments such as Node.js and VS Code when explicitly declared supported for stable releases

Additions and fixes are allowed when they preserve existing use. Intentional incompatible changes belong in a major release except for the exceptions below.

### Experimental

Experimental surfaces are outside the stable compatibility guarantee. They may change or be removed in any release as evaluation continues.

`@virune/compiler/experimental` is Experimental. Semantic Snapshot and Semantic Change Evidence also remain Experimental until the required evaluation is complete and they are explicitly stabilized. Completing evaluation alone does not make them Stable.

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

1. Mark the contract as deprecated and reflect that status in tools or type information when practical.
2. Provide a replacement or migration path.
3. Publish at least one stable release that still supports the old contract while marking it deprecated.
4. Make the incompatible change in a major release and document the affected version, the before-and-after behavior, and the required migration steps.

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

Do not expand the exception to unrelated Stable contracts or use it to bypass the normal compatibility rules.

Restoring an implementation to behavior already required by the normative Language Specification is not, by itself, a Language Specification change. If that correction is incompatible with another Stable contract, it must still satisfy this exception or wait for a major release.

## When canonical sources disagree

[`spec/`](spec/README.md) is normative for language behavior. Other public contracts are governed by their respective public APIs, ABIs, schemas, and machine-readable policies.

If the specification, implementation, tests, or snapshots disagree, do not choose the most convenient interpretation. Resolve the inconsistency before treating the behavior as a Stable guarantee.

Release notes or migration guidance cannot override the Language Specification or this compatibility policy. A snapshot update or green CI alone does not authorize an incompatible change.
