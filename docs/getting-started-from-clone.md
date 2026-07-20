# Try Virune from a clone

[English](getting-started-from-clone.md) | [日本語](getting-started-from-clone_ja.md)

## Requirements

- Node.js 24 or later
- npm
- Git

## Setup

Clone or download the published Virune repository, enter its root directory, and run:

```bash
npm run bootstrap
npm run build
npm run virune -- --version
```

`npm run bootstrap` runs `npm ci` while explicitly selecting the public npm registry. The equivalent direct command is:

```bash
npm ci --registry=https://registry.npmjs.org/ --replace-registry-host=never
```

## Included samples

```bash
npm run example
npm run virune -- run examples/user-directory -- Alice Bob
```

## Create a project

```bash
npm run virune -- init playground/hello
npm run virune -- check playground/hello
npm run virune -- build playground/hello
npm run virune -- run playground/hello
```

Pass arguments after a separator:

```bash
npm run virune -- run playground/hello -- Alice Bob
```

## Verify the repository

```bash
npm run verify
```

## When npm uses another registry

```bash
npm config get registry
npm config get replace-registry-host
env | grep -i '^npm_config_' || true
```

Use the repository bootstrap command to force the public registry:

```bash
npm run bootstrap
```

## Next steps

- Read the [language guide](language-guide.md).
- Browse the [standard library reference](standard-library.md).
- Check command details in the [CLI reference](cli-reference.md).
- Use the [normative specification](../spec/README.md) when exact language behavior matters.

## Node.js baseline

Virune requires Node.js 24 or newer. The repository includes `.nvmrc` and `.node-version`; `npm run node:check` verifies the active runtime before the full quality gate.
