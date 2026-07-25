# Security Policy

## Supported versions

Virune has not published its first stable GitHub Release yet. Until that release is available, security fixes are made on the `main` branch.

After the first stable release, the latest stable release line and `main` are supported. Older release lines are unsupported unless a maintainer explicitly announces a temporary backport window for a high-impact vulnerability.

| Version | Supported |
|---|---|
| `main` | Yes |
| Latest stable release | Yes, after publication |
| Older releases | No, unless explicitly announced |

## Reporting a vulnerability

Do not disclose suspected vulnerabilities in a public issue, discussion, pull request, or social channel.

Use [GitHub private vulnerability reporting](https://github.com/yaona807/virune/security/advisories/new) to submit a report. Include, when available:

- the affected version, release asset, or commit;
- the affected component, such as the compiler, runtime, CLI, VS Code extension, language server, or JavaScript interoperability layer;
- a minimal reproduction or proof of concept;
- the expected impact and required attacker capabilities;
- any known workaround or mitigation;
- whether the report is subject to a disclosure deadline.

If the private reporting form is unavailable, open a public issue containing only a request for a private security contact channel. Do not include vulnerability details in that issue.

Maintainers aim to acknowledge a complete report within three business days and provide an initial severity and remediation assessment within seven business days. Complex reports may require additional investigation.

## Scope and security model

Virune is not a security sandbox. Generated JavaScript executes with the permissions of its host environment. JavaScript execution, `unsafe` interoperability, third-party packages, generated project dependencies, and host APIs are outside Virune's static safety guarantees.

Reports are still in scope when they concern, for example:

- compiler, formatter, parser, or language-server crashes caused by untrusted source input;
- arbitrary code execution or unintended filesystem or process access in the CLI or extension;
- unsafe validation at JavaScript or TypeScript boundaries;
- malicious release assets, dependency confusion, or compromised build provenance;
- source-map, diagnostic, or generated-code behavior that exposes secrets;
- denial of service with a practical attack path against tooling or services.

## Private remediation workflow

1. Reproduce and triage the report in the private advisory workspace.
2. Record the affected versions, severity, exploit prerequisites, and disclosure plan.
3. Develop the fix in the advisory's private fork when disclosure before release would increase risk.
4. Add a regression test that fails before the fix and passes afterward whenever practical.
5. Run the relevant repository gates, including metadata validation, type checking, unit and integration tests, VS Code and language-server tests, release artifact verification, CodeQL, and dependency review.
6. Review transitive dependency changes, generated files, release metadata, and workflow permissions.
7. Prepare release notes, upgrade instructions, mitigations, and credit for the reporter when requested.
8. Publish the fixed release and GitHub Security Advisory together, or coordinate an agreed disclosure time.
9. Verify the published assets and checksums, then rotate or revoke any exposed credentials.
10. Close the advisory only after supported versions and public documentation identify the fixed version.

Security fixes should use the normal release workflow. Stable release assets are treated as immutable; a corrected version must be published instead of replacing an existing stable asset.

## Required repository security settings

Maintainers must verify the following settings before a stable release and review them at least quarterly:

- private vulnerability reporting is enabled;
- dependency graph, Dependabot alerts, security updates, and version updates are enabled;
- secret scanning is enabled;
- push protection for supported secrets is enabled;
- CodeQL advanced setup is active through `.github/workflows/codeql.yml`;
- dependency review is required for dependency-changing pull requests;
- branch protection or rulesets require the applicable CI and security checks;
- GitHub Actions permissions default to read-only, with write scopes granted only by workflows that require them.

Repository settings are not fully represented in Git, so this checklist must be confirmed in **Settings → Security and analysis**, **Settings → Actions**, and the branch ruleset configuration.

## Automated repository controls

The following controls are enforced from the repository and fail pull-request metadata validation when weakened:

- `.github/dependabot.yml` monitors npm and GitHub Actions dependencies;
- `.github/workflows/codeql.yml` analyzes JavaScript and TypeScript on pull requests, pushes, a weekly schedule, and manual runs;
- `.github/workflows/dependency-review.yml` reviews dependency changes and blocks moderate-or-higher runtime audit findings;
- `.github/actions-policy.json` allowlists external Action identities and revisions;
- `scripts/verify-workflows.mjs` requires every workflow to declare exact top-level permissions, defaults workflows to `contents: read`, and permits write scopes only through reviewed per-file exceptions;
- job-level permission overrides are prohibited so a job cannot silently escalate beyond the reviewed workflow grant.

Git-managed validation cannot prove the current state of private vulnerability reporting, secret scanning, push protection, repository-wide Actions defaults, or branch rulesets. An administrator must confirm those controls in GitHub settings during the quarterly review. A successful GitHub Dependency Review step provides operational evidence that the dependency graph is available for the pull request, while the runtime `npm audit` remains an independent blocking check.

## Public security discussions

After a coordinated disclosure, use the GitHub Security Advisory and release notes as the canonical public record. Public issues may track follow-up hardening work only after exploit-sensitive details are safe to disclose.
