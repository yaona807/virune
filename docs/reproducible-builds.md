# Reproducible release builds

[日本語](reproducible-builds_ja.md)

Virune verifies that stable release artifacts can be rebuilt byte-for-byte from the same source tree and lockfile.

## Local verification

The verifier requires Node.js 24 or later, npm, `tar`, and `unzip` on the command path.

```bash
npm run verify:reproducible-release
```

The command creates two independent temporary workspaces. Each workspace receives a clean source copy, runs `npm ci`, and executes the complete `verify:release` path. The verifier compares every file in the two `release/` directories.

`SOURCE_DATE_EPOCH` defaults to `0` and can be overridden when reproducing a historical release environment:

```bash
SOURCE_DATE_EPOCH=0 npm run verify:reproducible-release
```

Set `VIRUNE_KEEP_REPRO_WORKSPACES=1` only while diagnosing a local failure. Temporary workspaces otherwise remain outside the repository and are deleted after verification.

## Compared properties

The gate verifies:

- file presence, type, size, SHA-256 digest, and POSIX mode;
- symbolic-link targets;
- raw bytes of every npm tarball and VSIX;
- the complete expanded file tree of every npm tarball and VSIX;
- absence of either temporary workspace path from release files and expanded archive contents.

When archive bytes differ but expanded files match, the report classifies the failure as archive metadata or ordering. This normally indicates timestamps, entry order, compression metadata, or permissions that were not normalized.

## Release integrity files

Every release contains:

- `SHA256SUMS`, covering every published file except the checksum file itself;
- `RELEASE-MANIFEST.json` schema version 2, containing file sizes, SHA-256 digests, SBOM metadata, and attestation verification commands;
- `SBOM.cdx.json`, a deterministic CycloneDX 1.6 software bill of materials generated from the committed npm lockfile;
- `MANIFEST.json` and `VSCODE-MANIFEST.json`, which retain package-specific and VSIX-specific integrity metadata.

Verify all downloaded files from the release directory:

```bash
sha256sum --check SHA256SUMS
```

Inspect `RELEASE-MANIFEST.json` when only selected assets were downloaded. The recorded byte size and SHA-256 digest must match the local file.

## Build provenance and SBOM attestations

The stable release workflow creates two GitHub Artifact Attestations for every file in the release directory, including `SHA256SUMS`:

1. SLSA build provenance that binds each asset to the repository, commit, workflow and runner identity;
2. a CycloneDX SBOM attestation that binds the same assets to `SBOM.cdx.json`.

Verify an asset with GitHub CLI:

```bash
gh attestation verify virune-1.0.0.tgz --repo yaona807/virune
```

Require the CycloneDX SBOM predicate when verifying the SBOM association:

```bash
gh attestation verify virune-1.0.0.tgz \
  --repo yaona807/virune \
  --predicate-type https://cyclonedx.org/bom
```

The verification must identify `yaona807/virune` and the expected release workflow. Do not install an asset when its checksum, repository identity, subject digest, or attestation signature does not verify.

## Evidence

Evidence is written to `.cache/reproducible-release/`:

- `report.json` contains machine-readable build metadata, archive results, and typed differences;
- `summary.md` contains a human-readable result;
- `build-a.log` and `build-b.log` contain the independent install and release commands;
- `artifacts/build-a/` and `artifacts/build-b/` are retained only when outputs differ.

The Nightly workflow uploads this directory as `reproducible-release-evidence`. The stable release gate also executes the verifier and includes its evidence and candidate release files in the release dry-run artifact.

## Stable asset immutability

The normal tag-triggered release workflow refuses to run when the GitHub Release already exists and never uses `--clobber`. Stable assets therefore cannot be replaced by the normal publishing path.

An exceptional integrity repair is isolated in the manually dispatched `Release asset repair` workflow. It requires execution from `main`, the exact confirmation phrase, a written incident reason, and the `release-repair` environment. Repository administrators must configure required reviewers or equivalent deployment protection for that environment in GitHub settings. The workflow rebuilds the original tag, requires an identical asset-name set, records before and after SHA-256 inventories, uploads a 365-day audit artifact, creates new provenance and SBOM attestations, and only then replaces bytes. Additions or removals require a new release version.

## Release requirement

A stable release is blocked unless both independent builds succeed, all generated artifacts match, the SBOM and release manifest pass validation, and the latest required quality evidence is successful. An exception must not be introduced implicitly. Any intentional non-reproducible field requires a documented, narrowly scoped policy change and dedicated regression coverage.
