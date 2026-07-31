from pathlib import Path

path = Path('selfhost/mvp/src/frontend-parser-core.virune')
text = path.read_text()

if 'import { parsePatternJson } from "./frontend-pattern-parser.virune"' in text:
    raise SystemExit(0)

old_import = 'import { parseDetailedDeclarationJson } from "./frontend-declaration-parser.virune"\n'
new_import = old_import + 'import { parsePatternJson } from "./frontend-pattern-parser.virune"\n'
if old_import not in text:
    raise SystemExit('declaration parser import marker not found')
text = text.replace(old_import, new_import, 1)

transport_marker = '''record DetailedDeclarationTransport derives Json {
\tnextIndex: Int
\tnodes: List<FrontendAstNode>
\tdiagnostics: List<ParserDiagnostic>
\troot: Int
}
'''
transport_insert = transport_marker + '''
record PatternTransport derives Json {
\tnextIndex: Int
\tnodes: List<FrontendAstNode>
\tdiagnostics: List<ParserDiagnostic>
\troot: Int
}
'''
if transport_marker not in text:
    raise SystemExit('transport marker not found')
text = text.replace(transport_marker, transport_insert, 1)

old_stop = 'return isText(state, tokens, "}") || isText(state, tokens, "else")'
new_stop = '''return isText(state, tokens, "}")
\t\t|| isText(state, tokens, "else")
\t\t|| isText(state, tokens, ",")
\t\t|| isText(state, tokens, "=>")'''
if old_stop not in text:
    raise SystemExit('expression stop marker not found')
text = text.replace(old_stop, new_stop, 1)

primary_marker = 'fn parsePrimary(stateValue: CoreState, tokens: List<FrontendToken>, stopAtBrace: Bool) -> ParsedNode {'
helpers = r'''fn loadPattern(
\tstate: CoreState,
\ttokens: List<FrontendToken>,
) -> Result<PatternTransport, List<JsonError>> {
\tlet tokensEncoded = Json.encode<List<FrontendToken>>(tokens)?
\tlet encoded = parsePatternJson(tokensEncoded, state.index, List.length(state.nodes))?
\tlet raw = Json.parse(encoded)?
\treturn Json.decode<PatternTransport>(raw)
}

fn mergePatternValue(stateValue: CoreState, value: PatternTransport) -> ParsedNode {
\tlet state = CoreState {
\t\tindex: value.nextIndex,
\t\tnodes: List.concat(stateValue.nodes, value.nodes),
\t\tdiagnostics: List.concat(stateValue.diagnostics, value.diagnostics),
\t\tcommentIndex: stateValue.commentIndex,
\t\tpendingDocumentation: stateValue.pendingDocumentation,
\t\tmoduleDocumentation: stateValue.moduleDocumentation,
\t\tsignificantSeen: stateValue.significantSeen,
\t}
\treturn ParsedNode { state: state, id: value.root }
}

fn mergePatternFailure(stateValue: CoreState, tokens: List<FrontendToken>) -> ParsedNode {
\tlet failed = addDiagnosticAt(
\t\tstateValue,
\t\ttokens,
\t\t"P9001",
\t\t"Pattern parser transport failed",
\t\tstateValue.index,
\t)
\treturn ParsedNode { state: failed, id: -1 }
}

fn parsePatternNode(stateValue: CoreState, tokens: List<FrontendToken>) -> ParsedNode {
\treturn match loadPattern(stateValue, tokens) {
\t\tOk(value) => mergePatternValue(stateValue, value)
\t\tErr(_) => mergePatternFailure(stateValue, tokens)
\t}
}

fn synchronizeMatchArm(stateValue: CoreState, tokens: List<FrontendToken>) -> CoreState {
\tlet mut state = stateValue
\twhile !atEnd(state, tokens)
\t\t&& currentKind(state, tokens) != FrontendTokenKind.NewLine
\t\t&& !isText(state, tokens, "}") {
\t\tstate = advance(state)
\t}
\treturn skipNewLines(state, tokens)
}

fn parseMatchExpression(stateValue: CoreState, tokens: List<FrontendToken>) -> ParsedNode {
\tlet start = stateValue.index
\tlet mut state = advance(stateValue)
\tlet target = parseExpression(state, tokens, 1, true)
\tstate = target.state
\tlet mut children: List<Int> = []
\tif target.id >= 0 {
\t\tchildren = List.append(children, target.id)
\t}
\tif isText(state, tokens, "{") {
\t\tstate = skipNewLines(advance(state), tokens)
\t} else {
\t\tstate = addDiagnosticAt(state, tokens, "P0001", "Expected { after a match target", state.index)
\t\tstate = synchronizeMatchArm(state, tokens)
\t}
\twhile !atEnd(state, tokens) && !isText(state, tokens, "}") {
\t\tlet armStart = state.index
\t\tlet before = state.index
\t\tlet pattern = parsePatternNode(state, tokens)
\t\tstate = pattern.state
\t\tlet mut armChildren: List<Int> = []
\t\tif pattern.id >= 0 {
\t\t\tarmChildren = List.append(armChildren, pattern.id)
\t\t}
\t\tif isText(state, tokens, "if") {
\t\t\tlet guard = parseExpression(advance(state), tokens, 1, false)
\t\t\tstate = guard.state
\t\t\tif guard.id >= 0 {
\t\t\t\tarmChildren = List.append(armChildren, guard.id)
\t\t\t}
\t\t}
\t\tif isText(state, tokens, "=>") {
\t\t\tstate = advance(state)
\t\t} else {
\t\t\tstate = addDiagnosticAt(state, tokens, "P0001", "Expected => after a match pattern", state.index)
\t\t\tstate = synchronizeMatchArm(state, tokens)
\t\t}
\t\tif !atEnd(state, tokens) && !isText(state, tokens, "}") {
\t\t\tlet body = parseExpression(state, tokens, 1, false)
\t\t\tstate = body.state
\t\t\tif body.id >= 0 {
\t\t\t\tarmChildren = List.append(armChildren, body.id)
\t\t\t}
\t\t}
\t\tif isText(state, tokens, ",") {
\t\t\tstate = advance(state)
\t\t}
\t\tlet arm = addNode(
\t\t\tstate,
\t\t\ttokens,
\t\t\t"MatchArm",
\t\t\t"=>",
\t\t\tarmStart,
\t\t\tstate.index,
\t\t\tarmChildren,
\t\t\t[],
\t\t)
\t\tstate = skipNewLines(arm.state, tokens)
\t\tchildren = List.append(children, arm.id)
\t\tif state.index <= before {
\t\t\tstate = addDiagnosticAt(state, tokens, "P0001", "Parser made no progress in a match expression", state.index)
\t\t\tif !atEnd(state, tokens) {
\t\t\t\tstate = skipNewLines(advance(state), tokens)
\t\t\t}
\t\t}
\t}
\tif isText(state, tokens, "}") {
\t\tstate = advance(state)
\t} else {
\t\tstate = addDiagnosticAt(state, tokens, "P0001", "Expected } to end a match expression", state.index)
\t}
\treturn addNode(state, tokens, "MatchExpression", "match", start, state.index, children, [])
}

'''
if primary_marker not in text:
    raise SystemExit('parsePrimary marker not found')
text = text.replace(primary_marker, helpers + primary_marker, 1)

branch_marker = '''\tlet text = currentText(state, tokens)
\tif text == "!" || text == "-" || text == "await" {'''
branch_insert = '''\tlet text = currentText(state, tokens)
\tif text == "match" {
\t\treturn parseMatchExpression(state, tokens)
\t}
\tif text == "!" || text == "-" || text == "await" {'''
if branch_marker not in text:
    raise SystemExit('parsePrimary branch marker not found')
text = text.replace(branch_marker, branch_insert, 1)

path.write_text(text)
