# Virune for VS Code

Official VS Code language support for Virune.

## Features

- Virune TextMate syntax highlighting
- Syntax, type, import, and project diagnostics
- Document formatting
- Hover type information
- Document symbols and Outline support
- Go to Definition
- Keyword, symbol, local-variable, and field completion
- Semantic highlighting
- Compiler-provided Quick Fixes

## Installation

The extension is distributed as a VSIX file in the Virune GitHub Releases. It is not published to the Visual Studio Marketplace.

1. Download `virune-vscode-<version>.vsix` from the corresponding GitHub Release.
2. Run **Extensions: Install from VSIX...** in VS Code and select the downloaded file.

CLI installation is also supported:

```bash
code --install-extension virune-vscode-<version>.vsix
```

Installing a newer VSIX with the same extension identifier updates the existing installation.
