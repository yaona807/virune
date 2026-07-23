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
- Document symbols, Outline, and Breadcrumbs
- Go to Declaration, Go to Definition, Peek Definition, and Go to Type Definition
- Project-wide Find All References and document highlights
- Incoming and outgoing Call Hierarchy
- Safe workspace rename with import-alias awareness
- Workspace symbol search
- Reference and caller CodeLens for top-level declarations
- Completion for keywords, declarations, imports, parameters, local variables, and fields
- Auto-import completion for public Virune symbols
- **Organize Imports** source action
- JavaScript and TypeScript definition navigation through interop declaration metadata
- Quick Fix conversion for diagnostics that include compiler fixes
- Documentation comments in Hover, completion, and Signature Help
- `doc` / `moddoc` snippets and automatic continuation of non-empty `///` / `//!` lines on Enter
- **Virune: Generate Documentation Comment** and **Virune: Generate Module Documentation** commands
- Incremental parse, type-check, and emit reuse per project root

## Editor information settings

The extension enables latency-sensitive type information by default. Project-wide reference and caller CodeLens are disabled by default because they require a workspace index; enable them explicitly when needed:

```json
{
	"virune.inlayHints.variableTypes.enabled": true,
	"virune.inlayHints.functionReturnTypes.enabled": true,
	"virune.inlayHints.parameterNames": "literals",
	"virune.inlayHints.forLoopVariableTypes.enabled": true,
	"virune.inlayHints.lambdaParameterTypes.enabled": true,
	"virune.hover.showEffects": true,
	"virune.hover.showModule": true,
	"virune.codeLens.references.enabled": false,
	"virune.codeLens.callers.enabled": false,
	"virune.codeLens.visibility": "public"
}
```

`virune.inlayHints.parameterNames` accepts `none`, `literals`, or `all`. `virune.codeLens.visibility` accepts `public` or `all`. Inlay hints and CodeLens are visual annotations only and do not modify the Virune source file.

## Semantic navigation

Hover, diagnostics, inlay hints, semantic tokens, and document symbols analyze only the active document, its Virune imports, and open editor overlays. Definition navigation and document highlights use a focused semantic index for that graph. Project-wide operations such as references, rename, call hierarchy, workspace symbols, auto import, and enabled CodeLens build an index from every `.virune` source file under the project root. Unsaved editor buffers are treated as the current source of truth.

Virune import aliases remain local during rename. Renaming an original declaration updates canonical references across the workspace, while explicitly aliased local names remain unchanged. JavaScript and TypeScript imports are read-only from Virune rename operations, but definition navigation can open their declaration source when the interop provider exposes a declaration path.

## Development

```bash
npm ci
npm run test:vscode
npm run pack:vscode
```

The packaged extension is written to `release/virune-vscode-<version>.vsix`.

## Incremental analysis

The server owns one `IncrementalProjectBuilder` per project root. Overlay buffer text participates in source hashing, so unchanged modules and implementation-independent dependents reuse compiler state across edits. All project `.virune` files are editor-analysis entries, which keeps workspace symbols and auto imports complete without disabling compiler-level reuse.
