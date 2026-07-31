from pathlib import Path

header_path = Path('selfhost/mvp/src/frontend-lambda-parser.virune')
header = header_path.read_text()
invalid = 'tuple.state.nodes |> List.length |> fn(_) => [tuple.id]'
if invalid in header:
    header = header.replace(invalid, '[tuple.id]', 1)
    header_path.write_text(header)

path = Path('selfhost/mvp/src/frontend-parser-core.virune')
text = path.read_text()
if 'import { parseLambdaHeaderJson } from "./frontend-lambda-parser.virune"' in text:
    raise SystemExit(0)

old_import = 'import { parseDetailedDeclarationJson } from "./frontend-declaration-parser.virune"\n'
new_import = old_import + 'import { parseLambdaHeaderJson } from "./frontend-lambda-parser.virune"\n'
if old_import not in text:
    raise SystemExit('declaration parser import marker not found')
text = text.replace(old_import, new_import, 1)

transport_marker = '''record PatternTransport derives Json {
\tnextIndex: Int
\tnodes: List<FrontendAstNode>
\tdiagnostics: List<ParserDiagnostic>
\troot: Int
}
'''
transport_insert = transport_marker + '''
record LambdaHeaderTransport derives Json {
\tnextIndex: Int
\tnodes: List<FrontendAstNode>
\tdiagnostics: List<ParserDiagnostic>
\tchildren: List<Int>
\tisAsync: Bool
}

record LoadedLambdaHeader {
\tstate: CoreState
\tchildren: List<Int>
\tisAsync: Bool
}
'''
if transport_marker not in text:
    raise SystemExit('pattern transport marker not found')
text = text.replace(transport_marker, transport_insert, 1)

primary_marker = 'fn parsePrimary(stateValue: CoreState, tokens: List<FrontendToken>, stopAtBrace: Bool) -> ParsedNode {'
helpers = '''fn loadLambdaHeader(\n\tstate: CoreState,\n\ttokens: List<FrontendToken>,\n) -> Result<LambdaHeaderTransport, List<JsonError>> {\n\tlet tokensEncoded = Json.encode<List<FrontendToken>>(tokens)?\n\tlet encoded = parseLambdaHeaderJson(tokensEncoded, state.index, List.length(state.nodes))?\n\tlet raw = Json.parse(encoded)?\n\treturn Json.decode<LambdaHeaderTransport>(raw)\n}\n\nfn mergeLambdaHeaderValue(stateValue: CoreState, value: LambdaHeaderTransport) -> LoadedLambdaHeader {\n\tlet state = CoreState {\n\t\tindex: value.nextIndex,\n\t\tnodes: List.concat(stateValue.nodes, value.nodes),\n\t\tdiagnostics: List.concat(stateValue.diagnostics, value.diagnostics),\n\t\tcommentIndex: stateValue.commentIndex,\n\t\tpendingDocumentation: stateValue.pendingDocumentation,\n\t\tmoduleDocumentation: stateValue.moduleDocumentation,\n\t\tsignificantSeen: stateValue.significantSeen,\n\t}\n\treturn LoadedLambdaHeader { state: state, children: value.children, isAsync: value.isAsync }\n}\n\nfn mergeLambdaHeaderFailure(stateValue: CoreState, tokens: List<FrontendToken>) -> LoadedLambdaHeader {\n\tlet failed = addDiagnosticAt(\n\t\tstateValue,\n\t\ttokens,\n\t\t"P9002",\n\t\t"Lambda header parser transport failed",\n\t\tstateValue.index,\n\t)\n\treturn LoadedLambdaHeader { state: failed, children: [], isAsync: false }\n}\n\nfn parseLambdaHeaderNode(stateValue: CoreState, tokens: List<FrontendToken>) -> LoadedLambdaHeader {\n\treturn match loadLambdaHeader(stateValue, tokens) {\n\t\tOk(value) => mergeLambdaHeaderValue(stateValue, value)\n\t\tErr(_) => mergeLambdaHeaderFailure(stateValue, tokens)\n\t}\n}\n\nfn parseLambdaExpression(stateValue: CoreState, tokens: List<FrontendToken>) -> ParsedNode {\n\tlet start = stateValue.index\n\tlet loaded = parseLambdaHeaderNode(stateValue, tokens)\n\tlet mut state = loaded.state\n\tlet mut children = loaded.children\n\tif isText(state, tokens, "=>") {\n\t\tlet body = parseExpression(advance(state), tokens, 1, false)\n\t\tstate = body.state\n\t\tif body.id >= 0 {\n\t\t\tchildren = List.append(children, body.id)\n\t\t}\n\t} else if isText(state, tokens, "{") {\n\t\tlet body = parseBlock(state, tokens)\n\t\tstate = body.state\n\t\tchildren = List.append(children, body.id)\n\t} else {\n\t\tstate = addDiagnosticAt(state, tokens, "P0001", "Expected a lambda body", state.index)\n\t\tstate = synchronizeLine(state, tokens)\n\t}\n\tlet text = if loaded.isAsync then "async fn" else "fn"\n\treturn addNode(state, tokens, "LambdaExpression", text, start, state.index, children, [])\n}\n\n'''
if primary_marker not in text:
    raise SystemExit('parsePrimary marker not found')
text = text.replace(primary_marker, helpers + primary_marker, 1)

branch_marker = '''\tlet text = currentText(state, tokens)
\tif text == "match" {'''
branch_insert = '''\tlet text = currentText(state, tokens)
\tif text == "fn" || (text == "async" && tokenAt(tokens, state.index + 1).text == "fn") {
\t\treturn parseLambdaExpression(state, tokens)
\t}
\tif text == "match" {'''
if branch_marker not in text:
    raise SystemExit('parsePrimary match marker not found')
text = text.replace(branch_marker, branch_insert, 1)
path.write_text(text)
