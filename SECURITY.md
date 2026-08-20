# Security Policy

日本語: [SECURITY_ja.md](SECURITY_ja.md)

## Supported versions

`main` and the latest stable release are supported.

Older releases are unsupported unless otherwise announced.

## Reporting a vulnerability

If you find a security issue, do not post details in public Issues, GitHub Discussions, Pull Requests, or similar public channels.

Report it through GitHub's [private vulnerability reporting](https://github.com/yaona807/virune/security/advisories/new).

When possible, include:

- the affected version or component;
- how to reproduce the issue;
- the expected impact;
- any known workaround.

If private vulnerability reporting is unavailable, do not post vulnerability details in a public Issue.

## Scope

Virune is not a security sandbox.

Generated JavaScript executes with the permissions of its host environment. Integrations using `unsafe`, third-party packages, external APIs, and similar external capabilities are outside Virune's own safety guarantees.

Vulnerabilities caused by Virune's compiler, CLI, Visual Studio Code extension, language server, Interop, or similar Virune components are in scope for reporting.

## Response

Reported issues may be investigated and fixed privately when necessary.

Once disclosure is appropriate, information will be published through a fixed release or another suitable public channel.
