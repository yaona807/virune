# VS Code support

Virune provides a self-contained VS Code extension containing syntax highlighting and the Virune Language Server.

## Installation

Download `virune-vscode-<version>.vsix` from GitHub Releases and run:

```bash
code --install-extension virune-vscode-<version>.vsix
```

Alternatively, select **Extensions: Install from VSIX...** from the VS Code command palette.

The extension is not distributed through the Visual Studio Marketplace. Updates are installed by downloading and installing the newer VSIX from GitHub Releases.

## Included language features

- `.virune` language registration
- Syntax and semantic highlighting
- Diagnostics for lexer, parser, type, import, and project errors
- Document formatting
- Hover information
- Document symbols
- Go to Definition
- Completion for keywords, declarations, imports, parameters, local variables, and fields
- Quick Fix conversion for diagnostics that include compiler fixes
- Incremental parse, type-check, and emit reuse per project root

## Development

```bash
npm ci
npm run test:vscode
npm run pack:vscode
```

The packaged extension is written to `release/virune-vscode-<version>.vsix`.

## Incremental analysis

The server owns one `IncrementalProjectBuilder` per project root. Overlay buffer text participates in source hashing, so unchanged modules and implementation-independent dependents reuse compiler state across edits.
