# Security Policy

日本語: [SECURITY_ja.md](SECURITY_ja.md)

## Supported versions

The latest stable release line and `main` are supported. Older release lines are unsupported unless a maintainer explicitly announces a temporary backport window for a high-impact vulnerability.

| Version | Supported |
|---|---|
| `main` | Yes |
| Latest stable release | Yes |
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

If GitHub private vulnerability reporting is unavailable, the public **Security contact request** Issue Form may be used only when your GitHub profile already exposes a contact method that supports private communication and you are willing for the Virune maintainer to use it. The request Issue, its author, title, and body are public and editable. Keep both title and body free of vulnerability details, affected versions, reproduction or exploit steps, secrets, contact addresses, and other sensitive information. Do not use the public form if the fact that you are requesting security contact must itself remain confidential. The maintainer may use the private-capable contact route already published on your profile to continue privately.

If your profile has no usable private-capable contact route, Virune cannot currently promise a confidential project-level fallback intake path. Do not disclose vulnerability details publicly merely to obtain a response. Unknown private-delivery capability must not be treated as available.

For a report that Virune actually receives through a private channel with sufficient information to begin triage, maintainers aim to acknowledge the report within three business days and provide an initial severity and remediation assessment within seven business days. Complex reports may require additional investigation.

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
- `.github/workflows/dependency-review.yml` requests moderate-or-higher change-level findings from GitHub Dependency Review and always blocks moderate-or-higher findings across all locked runtime and development dependencies with `npm audit`;
- `.github/actions-policy.json` allowlists external Action identities and revisions;
- `scripts/verify-workflows.mjs` requires every workflow to declare exact top-level permissions, defaults workflows to `contents: read`, and permits write scopes only through reviewed per-file exceptions;
- job-level permission overrides are prohibited so a job cannot silently escalate beyond the reviewed workflow grant.

Git-managed validation cannot prove the current state of private vulnerability reporting, secret scanning, push protection, repository-wide Actions defaults, or branch rulesets. An administrator must confirm those controls in GitHub settings during the quarterly review. When GitHub change-level review is unavailable, the workflow reports that limitation explicitly and retains the complete locked-dependency audit as the blocking fallback. Enabling Dependency Graph remains required before the GitHub review result itself can become a required gate.

## Public security discussions

After a coordinated disclosure, use the GitHub Security Advisory and release notes as the canonical public record. Public issues may track follow-up hardening work only after exploit-sensitive details are safe to disclose.
