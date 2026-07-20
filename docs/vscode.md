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
- Rich hover information for functions, inferred types, records, enums, and source locations
- Inlay hints for inferred variable, function return, loop variable, and lambda parameter types
- Configurable parameter-name inlay hints at call sites
- Signature Help with the active parameter, return type, and `uses` capabilities
- Document symbols
- Go to Definition
- Completion for keywords, declarations, imports, parameters, local variables, and fields
- Quick Fix conversion for diagnostics that include compiler fixes
- Incremental parse, type-check, and emit reuse per project root

## Editor information settings

The extension enables type-oriented editor information by default. These settings can be changed in VS Code settings:

```json
{
	"virune.inlayHints.variableTypes.enabled": true,
	"virune.inlayHints.functionReturnTypes.enabled": true,
	"virune.inlayHints.parameterNames": "literals",
	"virune.inlayHints.forLoopVariableTypes.enabled": true,
	"virune.inlayHints.lambdaParameterTypes.enabled": true,
	"virune.hover.showEffects": true,
	"virune.hover.showModule": true
}
```

`virune.inlayHints.parameterNames` accepts `none`, `literals`, or `all`. Inlay hints are visual annotations only and do not modify the Virune source file.

## Development

```bash
npm ci
npm run test:vscode
npm run pack:vscode
```

The packaged extension is written to `release/virune-vscode-<version>.vsix`.

## Incremental analysis

The server owns one `IncrementalProjectBuilder` per project root. Overlay buffer text participates in source hashing, so unchanged modules and implementation-independent dependents reuse compiler state across edits.
