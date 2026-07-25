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

## Evidence

Evidence is written to `.cache/reproducible-release/`:

- `report.json` contains machine-readable build metadata, archive results, and typed differences;
- `summary.md` contains a human-readable result;
- `build-a.log` and `build-b.log` contain the independent install and release commands;
- `artifacts/build-a/` and `artifacts/build-b/` are retained only when outputs differ.

The Nightly workflow uploads this directory as `reproducible-release-evidence`. The stable release gate also executes the verifier and includes its evidence in the release dry-run artifact.

## Release requirement

A stable release is blocked unless both independent builds succeed and all generated artifacts match. An exception must not be introduced implicitly. Any intentional non-reproducible field requires a documented, narrowly scoped policy change and dedicated regression coverage.
