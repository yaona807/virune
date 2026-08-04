# Focused Self-host Tests

`selfhost:focused` runs one compiled self-host compiler test through the repository's existing unit-test runner. It is the permanent replacement for temporary workflows and diagnostic-only pull requests that existed only to execute one generated-compiler regression test.

## Commands

```bash
npm run selfhost:focused -- --case=expected-list-literals
npm run selfhost:focused:built -- --case=generic-json-type-arguments
npm run selfhost:focused:built -- --list
```

`selfhost:focused` builds the repository first. `selfhost:focused:built` reuses an existing build. `--list` prints selectable case identifiers in deterministic order.

## Selection boundary

A case identifier maps only to a compiled file named `packages/compiler/dist/test/selfhost-<case>.test.js`. Identifiers use lowercase letters, digits, and single hyphens. The command does not accept paths, glob patterns, regular expressions, Node.js options, or test-name patterns.

The full-language inventory is intentionally not a focused case. Run it with:

```bash
npm run selfhost:inventory
```

Unknown and ambiguous cases fail before a child process is started and print the available case identifiers.

## Execution model

The focused command delegates execution to `scripts/run-unit-tests.mjs` with one exact repository-relative compiled test path. The existing runner remains responsible for Node.js test isolation, timeouts, failure output, and exit status. The focused command does not implement a second test runner and does not invoke a shell.

No dedicated GitHub Actions job is added. The command is for local and agent-driven focused validation before the normal pull-request gates run.
