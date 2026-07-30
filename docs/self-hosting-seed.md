# Stage 0 self-hosting seed

[日本語](self-hosting-seed_ja.md)

The Stage 0 seed is the reviewed TypeScript compiler artifact that bootstraps the future Virune compiler kernel. It is a fixed trust root, not a moving dependency and not the production compiler selection mechanism.

## Fixed seed

The machine-readable manifest is [`../.github/self-hosting/stage0-seed.json`](../.github/self-hosting/stage0-seed.json), validated against [`../.github/self-hosting/stage0-seed.schema.json`](../.github/self-hosting/stage0-seed.schema.json).

The initial seed is fixed to:

- Virune and language version: `1.0.0` / `1.0`;
- immutable release tag and commit: `v1.0.0` / `dcaf89b2f557fde38cdfd9bceb7d23af3ba8ed51`;
- compiler asset: `virune-compiler-1.0.0.tgz`;
- SHA-256: `69c9d54a925377a2331ba39a229ab5809d946eef54bc43a5f14601eafd87d7b4`;
- byte size: `143161`;
- Node.js baseline: `24.0.0` with package engine `>=24.0.0`;
- Runtime ABI / Interop ABI: `2` / `2`;
- normalized artifact policy: `1`.

The asset identity and checksum are anchored to the committed v1.0.0 public verification evidence. The release was subsequently restored and fully reverified without rebuilding the asset; the manifest records both verification and recovery run identifiers.

## Clean-environment verification

Requirements:

- Node.js 24 or later;
- `tar` on `PATH`;
- HTTPS access to the GitHub Release when the artifact is not already cached.

Run:

```bash
npm run selfhost:seed:verify
```

The command downloads the fixed compiler asset to `.cache/selfhost-seed/` when absent, then verifies:

1. manifest structure, versions, baselines and manual-update policy;
2. release tag, commit, asset name, byte size and SHA-256 against the committed release-verification record;
3. downloaded byte size and SHA-256;
4. `package/package.json` inside the tarball, including package name, version, module type, Node.js engine and exact `@virune/runtime` dependency;
5. absence of a package script or GitHub Actions workflow that can automatically rewrite the seed manifest.

To verify an already downloaded asset without network access:

```bash
npm run selfhost:seed:verify -- --artifact /absolute/path/to/virune-compiler-1.0.0.tgz
```

Use `--json` for a machine-readable success report. Verification is fail-closed: missing files, HTTP failures, unexpected metadata, size differences, checksum differences, version mismatches, ABI mismatches and automatic-update paths all fail with a non-zero exit code.

## Update policy

The seed never follows the newest release automatically. Updating it requires all of the following in one reviewed pull request:

1. a dedicated tracking issue explaining why the trust root must change;
2. a stable, immutable and publicly verified release asset;
3. updated release evidence, manifest values and review record;
4. explicit review of the asset name, source URL, release commit, byte size, SHA-256, Node.js baseline, ABI versions and normalized artifact policy;
5. successful missing, tampered, metadata-mismatch, version-mismatch, ABI-mismatch and no-automatic-update tests;
6. successful repository quality, API, ABI, security and reproducibility gates.

There is intentionally no `selfhost:seed:update` command and no workflow with permission to rewrite the manifest. A new release alone is not authorization to change Stage 0.

## Scope boundary

This seed definition does not generate Stage 1 or Stage 2, select the self-host compiler for normal `virune` commands, modify the stable Compiler API, or change Runtime ABI v2 or Interop ABI v2. Those transitions require later self-hosting gates.
