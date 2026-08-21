# Reproducible releases

[日本語版](reproducible-builds_ja.md)

A Virune stable release must be reproducible byte-for-byte from the same source tree and lockfile.

## Verify locally

### Prerequisites

Run the verifier in an environment with:

- Node.js 24 or later;
- npm;
- `tar`;
- `unzip`.

When verifying a release candidate, check out the intended commit and make sure there are no unintended local changes.

### Run the verifier

From the repository root, run:

```bash
npm run verify:reproducible-release
```

The command creates two independent temporary workspaces outside the repository. It copies clean source into each workspace, runs `npm ci --no-audit --no-fund` and `npm run verify:release`, then compares the two `release/` directories.

On success, the command reports that the release is reproducible and prints the evidence path.

On failure, inspect the evidence in this order:

1. Read `.cache/reproducible-release/summary.md` for a human-readable summary.
2. Read `.cache/reproducible-release/report.json` for machine-readable differences.
3. Compare `build-a.log` and `build-b.log` to identify where the two builds diverged.
4. When output artifacts differ, compare `artifacts/build-a/` and `artifacts/build-b/`.

Do not simply retry until the command happens to pass without understanding the failure.

### Keep temporary workspaces for investigation

Temporary workspaces are normally deleted after verification. Keep them only when you need to inspect the failed environments directly.

In Bash or a similar shell:

```bash
VIRUNE_KEEP_REPRO_WORKSPACES=1 npm run verify:reproducible-release
```

In PowerShell:

```powershell
$env:VIRUNE_KEEP_REPRO_WORKSPACES='1'
npm run verify:reproducible-release
```

Remove retained temporary workspaces after the investigation is complete.

### Set `SOURCE_DATE_EPOCH`

The default value is `0`. Override it only when you need to reproduce a release environment with an explicitly different value.

Bash or similar:

```bash
SOURCE_DATE_EPOCH=0 npm run verify:reproducible-release
```

PowerShell:

```powershell
$env:SOURCE_DATE_EPOCH='0'
npm run verify:reproducible-release
```

## What is compared

The comparison is between two `release/` directories produced in separate temporary workspaces from the same commit and lockfile.

This comparison is intended to detect accidental build inputs outside the source and lockfile, such as build timestamps, temporary-workspace paths, or file ordering. If two independent builds from the same inputs produce matching `release/` directories, the verifier confirms, within its checked conditions, that the build output does not depend on those transient environment details. This keeps published artifacts reproducible from the same source later and makes their identity independently verifiable.

Matching only one artifact is not enough: if another published file changes from build to build, the release as a whole is not reproducible. The verifier therefore compares the complete `release/` output rather than only a selected package.

Corresponding files are checked for:

- file presence, type, size, SHA-256 digest, and POSIX permissions;
- symbolic-link targets;
- raw bytes of npm tarballs and VSIX files;
- complete expanded file trees of npm tarballs and VSIX files;
- absence of temporary-workspace paths from release artifacts and expanded archive contents.

If archive bytes differ while the expanded contents match, the verifier reports the difference as archive metadata or ordering, such as timestamps, entry order, compression metadata, or permissions.

## Verify published release integrity

Stable releases include:

- `SHA256SUMS`: SHA-256 digests for published files except `SHA256SUMS` itself;
- `RELEASE-MANIFEST.json`: the schema version 2 release manifest;
- `SBOM.cdx.json`: a deterministic CycloneDX 1.6 SBOM generated from the committed npm lockfile;
- `MANIFEST.json` and `VSCODE-MANIFEST.json`: package-specific and VSIX-specific integrity metadata.

### When the complete release set was downloaded

When `sha256sum` is available, place `SHA256SUMS` and the downloaded release files in the same directory, then run:

```bash
sha256sum --check SHA256SUMS
```

Confirm that every entry succeeds. Do not use an artifact if any checksum fails.

If `sha256sum` is not available, verify the recorded file size and SHA-256 digest for each file against `RELEASE-MANIFEST.json` using the procedure below.

### When only selected artifacts were downloaded

Open `RELEASE-MANIFEST.json` and check the selected artifact:

1. The file name matches.
2. The recorded byte size matches the local file size.
3. The recorded SHA-256 digest matches the local file digest.

For example, to verify `virune-1.0.0.tgz`, check its byte size on Linux or macOS with:

```bash
wc -c < virune-1.0.0.tgz
```

In PowerShell:

```powershell
(Get-Item .\virune-1.0.0.tgz).Length
```

Check the SHA-256 digest with the command available on the current platform.

Linux and other environments with `sha256sum`:

```bash
sha256sum virune-1.0.0.tgz
```

macOS and environments with `shasum`:

```bash
shasum -a 256 virune-1.0.0.tgz
```

PowerShell:

```powershell
(Get-FileHash .\virune-1.0.0.tgz -Algorithm SHA256).Hash
```

Do not use the artifact if any of these checks cannot be completed successfully.

## Verify GitHub Artifact Attestations

The stable `Release` workflow creates the following attestations for published files, including `SHA256SUMS`:

- SLSA build provenance binding each artifact to the repository, commit, workflow, and runner identity;
- a CycloneDX SBOM attestation binding the artifact to `SBOM.cdx.json`.

This verification uses GitHub CLI (`gh`).

1. Change to the directory containing the artifact.
2. Verify build provenance.

```bash
gh attestation verify virune-1.0.0.tgz --repo yaona807/virune
```

3. Confirm that the output identifies `yaona807/virune` and the expected `Release` workflow.
4. To verify the SBOM association, restrict the attestation to the CycloneDX SBOM predicate type.

```bash
gh attestation verify virune-1.0.0.tgz \
  --repo yaona807/virune \
  --predicate-type https://cyclonedx.org/bom
```

`https://cyclonedx.org/bom` is the official identifier for the CycloneDX BOM predicate type. The command does not download content from that URL or import the specification text into Virune.

Do not install an artifact if its checksum, repository identity, subject digest, or attestation signature cannot be verified.

## Reproducibility evidence

Local verification writes evidence to `.cache/reproducible-release/`:

- `report.json`: build information, archive results, and typed differences;
- `summary.md`: the human-readable result;
- `build-a.log` and `build-b.log`: logs from the two independent builds;
- `artifacts/build-a/` and `artifacts/build-b/`: copies retained only when outputs differ.

Nightly uploads this directory as `reproducible-release-evidence`. `Release dry run` executes the same verification and retains the evidence together with candidate release artifacts.

## Do not modify published stable releases

The normal tag-triggered `Release` workflow stops when the same GitHub Release already exists and does not overwrite published assets.

If artifacts need to be added or removed, publish a new version instead of changing an existing stable release.

`Release asset repair` is an emergency procedure for the case where published file contents are corrupted, tampered with, or otherwise incorrect while the original tag and source remain correct. It rebuilds the same tag and restores the correct contents under the same asset names. It must not be used to add new features or new release assets.

### Example use cases

For example, suppose the `v1.0.0` tag and source are correct and reproducibility verification confirms that the same artifact can be generated again, but the SHA-256 of `virune-1.0.0.tgz` on the GitHub Release does not match that reproduced artifact. `Release asset repair` can rebuild the correct artifact from the same tag and restore it under the same file name.

The same procedure applies when a published file is confirmed to differ from the correct reproducible output because of post-publication tampering or a publishing-path incident.

Do not use this procedure to fix source-code defects, add a new artifact, or change package contents or behavior. Those changes require a new release version.

### Prerequisites for `Release asset repair`

Before running it, confirm that:

- the target is an existing stable release tag;
- the original tag and source are correct, and only the published artifact contents require repair;
- the repair keeps the existing asset-name set and does not add or remove assets;
- the repair reason can be described specifically in at least 20 characters;
- the GitHub `release-repair` environment has required reviewers or equivalent deployment protection configured;
- the workflow can be dispatched from `main`.

### `Release asset repair` procedure

1. Open **Actions** in the Virune GitHub repository.
2. Select **Release asset repair**, then open **Run workflow**.
3. Select `main` as the branch used to run the workflow.
4. Enter the existing target tag in `tag`, for example `v1.0.0`.
5. Enter an incident or integrity reason of at least 20 characters in `reason`.
6. Enter the exact string `REPLACE_STABLE_ASSETS` in `confirm`.
7. Start **Run workflow** and complete any required approval for the `release-repair` environment.
8. Confirm that the `Audit and replace stable assets` job succeeds.
9. Download `release-repair-<tag>-<run id>` from Artifacts and inspect the before/after SHA-256 inventory and reproducibility evidence. This audit artifact is retained for 365 days.
10. Download the repaired assets from the GitHub Release and verify the checksums and GitHub Artifact Attestations again using the procedures above.

The workflow verifies the tag against `package.json`, checks the tag commit and existing GitHub Release, and requires the asset-name set to remain identical. It rebuilds the tagged release, writes and uploads audit evidence, and creates new provenance and SBOM attestations before the final replacement step.

If an earlier validation step fails, do not bypass it to reach replacement. If the asset-name set must change, create a new release instead of repairing the existing one.

## Stable release requirements

Do not publish a stable release unless all of the following are true:

- both independent builds succeed;
- the two `release/` directories produced by those builds match under the comparison rules above;
- the SBOM and release manifest pass validation;
- the latest required quality evidence is successful.

No implicit exception is allowed. Any intentionally non-reproducible value requires a narrowly scoped policy change, documented reasoning, and dedicated regression coverage.
