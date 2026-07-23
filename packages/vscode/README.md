# Virune for VS Code

Official VS Code language support for Virune.

## Features

- Virune TextMate syntax highlighting
- Syntax, type, import, and project diagnostics
- Document formatting
- Rich hover information for functions, inferred types, records, enums, and source locations
- Inlay hints for inferred types and call-site parameter names
- Signature Help with active-parameter highlighting
- Document symbols, Outline, and Breadcrumbs
- Declaration, definition, Peek Definition, and type-definition navigation
- Project-wide references, document highlights, and symbol search
- Incoming and outgoing call hierarchy
- Alias-aware workspace rename
- Reference and caller CodeLens
- Keyword, symbol, local-variable, and field completion
- Auto imports and Organize Imports
- JavaScript and TypeScript declaration navigation for interop imports
- Semantic highlighting
- Compiler-provided Quick Fixes
- Documentation comments in Hover, completion, and Signature Help
- `doc` and `moddoc` snippets, Enter continuation, and documentation-generation commands

## Installation

The extension is distributed as a VSIX file in the Virune GitHub Releases. It is not published to the Visual Studio Marketplace.

1. Download `virune-vscode-<version>.vsix` from the corresponding GitHub Release.
2. Run **Extensions: Install from VSIX...** in VS Code and select the downloaded file.

CLI installation is also supported:

```bash
code --install-extension virune-vscode-<version>.vsix
```

Installing a newer VSIX with the same extension identifier updates the existing installation.
