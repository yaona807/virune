# Stable release gate

[English](stable-release-gate.md) | [日本語](stable-release-gate_ja.md)

Virune can be promoted to the `stable` channel only when all requirements in `.github/stable-release-gate.json` pass.

The gate is executed by the same `npm run release:gate` command in both the tag-driven Release workflow and the manual Release dry-run workflow. It writes `.cache/release/release-evidence.json`, containing the version, commit, individual check results, requirement-to-evidence mapping, durations, and the latest accepted Nightly run.

The machine-readable requirements cover:

- Formatter comment anchoring, idempotence, regression tests, and fuzz smoke.
- Structured-concurrency cancellation and settlement on Node.js and browser runtimes.
- Stable Compiler API and Runtime v2, Interop v2, and Stdlib public ABI snapshots.
- Normative specification and grammar coverage.
- Node.js and browser conformance from a clean checkout.
- FFI Unknown fallbacks, unsafe boundaries, and the reviewed binding corpus.
- Parser, formatter, checker, and semantic fuzz suites.
- Public release packages, manifests, checksums, VSIX packaging, offline clean installation, and generated-project execution.
- The canonical npm prepublication plan, including its fail-closed version fence, explicit non-ready state, package classification, and unresolved publication blockers. This stable-gate check does not by itself enable npm publication or resolve the separate publication-workflow integration blocker.
- The npm publication identity that binds every planned Registry package to the exact reviewed Registry candidate tarball filename, SHA-256 digest, and byte size before any Registry publication is enabled.
- A successful Nightly quality run within the maximum age defined by policy whose `head_sha` exactly matches the release commit.

For the exact release commit, the gate inspects recent completed Nightly runs in newest-first order. Later `cancelled` or `skipped` runs do not hide an earlier usable result, while a newer completed failure still blocks the release instead of falling back to an older success.

Run a local structural check with:

```bash
npm run release:check
npm run abi:check
```

The complete gate requires GitHub Actions credentials to verify recent Nightly evidence. Start **Release dry run** from the Actions tab. A stable tag must not be created until that workflow succeeds for the exact commit to be tagged.

Intentional ABI changes require updating the reviewed snapshot with `npm run abi:update`, documenting compatibility impact, and changing the versioned ABI path when the change is breaking.
