# Third-Party Notices

The Virune VS Code extension bundles the Virune compiler and formatter together with the Microsoft Language Server Protocol libraries and their transitive runtime dependencies.

| Package group | License | Usage |
|---|---|---|
| `vscode-languageclient`, `vscode-languageserver`, `vscode-jsonrpc`, `vscode-languageserver-protocol`, `vscode-languageserver-types`, `vscode-languageserver-textdocument` | MIT | VS Code Language Client and Language Server Protocol transport |
| Chevrotain and scoped dependencies | Apache-2.0 | Virune lexer and parser |
| `@jridgewell/*` source map packages | MIT | Virune compiler source maps |
| Virune compiler, formatter, and runtime packages | Apache-2.0 | Bundled Virune language implementation |

This table is a summary. The packaged VSIX includes `dist/THIRD_PARTY_LICENSES.txt`, generated deterministically from the actual bundled npm packages and their license, notice, and copyright files. Virune and this extension are licensed under the Apache License 2.0.
