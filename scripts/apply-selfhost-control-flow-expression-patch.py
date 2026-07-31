from pathlib import Path

path = Path('selfhost/mvp/src/frontend-parser-core.virune')
text = path.read_text()
if 'fn parseConditionalExpression(' in text:
    raise SystemExit(0)

old_stop = '''\treturn isText(state, tokens, "}")
\t\t|| isText(state, tokens, "else")
\t\t|| isText(state, tokens, ",")
\t\t|| isText(state, tokens, "=>")'''
new_stop = '''\treturn isText(state, tokens, "}")
\t\t|| isText(state, tokens, "then")
\t\t|| isText(state, tokens, "else")
\t\t|| isText(state, tokens, ",")
\t\t|| isText(state, tokens, "=>")'''
if old_stop not in text:
    raise SystemExit('expression stop marker not found')
text = text.replace(old_stop, new_stop, 1)

primary_marker = 'fn parsePrimary(stateValue: CoreState, tokens: List<FrontendToken>, stopAtBrace: Bool) -> ParsedNode {'
helpers = '''fn parseControlPostfix(
\tstateValue: CoreState,
\ttokens: List<FrontendToken>,
\tstart: Int,
\tvalueIdValue: Int,
) -> ParsedNode {
\tlet mut state = stateValue
\tlet mut valueId = valueIdValue
\tlet mut done = false
\twhile !done && !expressionStop(state, tokens, false) {
\t\tif isText(state, tokens, "(") {
\t\t\tlet callArguments = consumeBalanced(state, tokens, "(", ")", "CallArguments")
\t\t\tstate = callArguments.state
\t\t\tlet call = addNode(
\t\t\t\tstate,
\t\t\t\ttokens,
\t\t\t\t"CallExpression",
\t\t\t\t"call",
\t\t\t\tstart,
\t\t\t\tstate.index,
\t\t\t\t[valueId, callArguments.id],
\t\t\t\t[],
\t\t\t)
\t\t\tstate = call.state
\t\t\tvalueId = call.id
\t\t} else if isText(state, tokens, ".") {
\t\t\tstate = advance(state)
\t\t\tlet field = currentText(state, tokens)
\t\t\tif !atEnd(state, tokens) {
\t\t\t\tstate = advance(state)
\t\t\t}
\t\t\tlet member = addNode(
\t\t\t\tstate,
\t\t\t\ttokens,
\t\t\t\t"FieldExpression",
\t\t\t\tfield,
\t\t\t\tstart,
\t\t\t\tstate.index,
\t\t\t\t[valueId],
\t\t\t\t[],
\t\t\t)
\t\t\tstate = member.state
\t\t\tvalueId = member.id
\t\t} else if isText(state, tokens, "?") {
\t\t\tstate = advance(state)
\t\t\tlet tried = addNode(
\t\t\t\tstate,
\t\t\t\ttokens,
\t\t\t\t"TryExpression",
\t\t\t\t"?",
\t\t\t\tstart,
\t\t\t\tstate.index,
\t\t\t\t[valueId],
\t\t\t\t[],
\t\t\t)
\t\t\tstate = tried.state
\t\t\tvalueId = tried.id
\t\t} else {
\t\t\tdone = true
\t\t}
\t}
\treturn ParsedNode { state: state, id: valueId }
}

fn parseConditionalExpression(stateValue: CoreState, tokens: List<FrontendToken>) -> ParsedNode {
\tlet start = stateValue.index
\tlet condition = parseExpression(advance(stateValue), tokens, 1, false)
\tlet mut state = condition.state
\tlet mut children: List<Int> = []
\tif condition.id >= 0 {
\t\tchildren = List.append(children, condition.id)
\t}
\tif isText(state, tokens, "then") {
\t\tstate = advance(state)
\t} else {
\t\tstate = addDiagnosticAt(state, tokens, "P0001", "Expected then in a conditional expression", state.index)
\t}
\tlet consequent = parseExpression(state, tokens, 1, false)
\tstate = consequent.state
\tif consequent.id >= 0 {
\t\tchildren = List.append(children, consequent.id)
\t}
\tif isText(state, tokens, "else") {
\t\tstate = advance(state)
\t} else {
\t\tstate = addDiagnosticAt(state, tokens, "P0001", "Expected else in a conditional expression", state.index)
\t}
\tlet alternate = parseExpression(state, tokens, 1, false)
\tstate = alternate.state
\tif alternate.id >= 0 {
\t\tchildren = List.append(children, alternate.id)
\t}
\treturn addNode(state, tokens, "ConditionalExpression", "if", start, state.index, children, [])
}

fn synchronizeParallelEntry(stateValue: CoreState, tokens: List<FrontendToken>) -> CoreState {
\tlet mut state = stateValue
\twhile !atEnd(state, tokens)
\t\t&& currentKind(state, tokens) != FrontendTokenKind.NewLine
\t\t&& !isText(state, tokens, ",")
\t\t&& !isText(state, tokens, "}") {
\t\tstate = advance(state)
\t}
\treturn state
}

fn parseParallelEntry(stateValue: CoreState, tokens: List<FrontendToken>) -> ParsedNode {
\tlet start = stateValue.index
\tlet mut state = stateValue
\tlet name = currentText(state, tokens)
\tif currentKind(state, tokens) == FrontendTokenKind.Identifier {
\t\tstate = advance(state)
\t} else {
\t\tstate = addDiagnosticAt(state, tokens, "P0001", "Expected a parallel entry name", state.index)
\t}
\tif isText(state, tokens, ":") {
\t\tstate = advance(state)
\t} else {
\t\tstate = addDiagnosticAt(state, tokens, "P0001", "Expected : after a parallel entry name", state.index)
\t\tstate = synchronizeParallelEntry(state, tokens)
\t\treturn addNode(state, tokens, "ParallelEntry", name, start, state.index, [], [])
\t}
\tlet value = parseExpression(state, tokens, 1, false)
\tstate = value.state
\tlet mut children: List<Int> = []
\tif value.id >= 0 {
\t\tchildren = List.append(children, value.id)
\t}
\treturn addNode(state, tokens, "ParallelEntry", name, start, state.index, children, [])
}

fn parseParallelExpression(stateValue: CoreState, tokens: List<FrontendToken>) -> ParsedNode {
\tlet start = stateValue.index
\tlet mut state = advance(stateValue)
\tlet mut text = "parallel"
\tif isText(state, tokens, "try") {
\t\ttext = "parallel try"
\t\tstate = advance(state)
\t}
\tif isText(state, tokens, "{") {
\t\tstate = skipNewLines(advance(state), tokens)
\t} else {
\t\tstate = addDiagnosticAt(state, tokens, "P0001", "Expected { after parallel", state.index)
\t\tstate = synchronizeParallelEntry(state, tokens)
\t}
\tlet mut children: List<Int> = []
\twhile !atEnd(state, tokens) && !isText(state, tokens, "}") {
\t\tlet before = state.index
\t\tlet entry = parseParallelEntry(state, tokens)
\t\tstate = entry.state
\t\tif entry.id >= 0 {
\t\t\tchildren = List.append(children, entry.id)
\t\t}
\t\tif isText(state, tokens, ",") {
\t\t\tstate = advance(state)
\t\t}
\t\tstate = skipNewLines(state, tokens)
\t\tif state.index <= before {
\t\t\tstate = addDiagnosticAt(state, tokens, "P0001", "Parser made no progress in a parallel expression", state.index)
\t\t\tif !atEnd(state, tokens) {
\t\t\t\tstate = skipNewLines(advance(state), tokens)
\t\t\t}
\t\t}
\t}
\tif List.length(children) == 0 {
\t\tstate = addDiagnosticAt(state, tokens, "P0001", "Expected at least one parallel entry", state.index)
\t}
\tif isText(state, tokens, "}") {
\t\tstate = advance(state)
\t} else {
\t\tstate = addDiagnosticAt(state, tokens, "P0001", "Expected } to end a parallel expression", state.index)
\t}
\tlet expression = addNode(state, tokens, "ParallelExpression", text, start, state.index, children, [])
\treturn parseControlPostfix(expression.state, tokens, start, expression.id)
}

'''
if primary_marker not in text:
    raise SystemExit('parsePrimary marker not found')
text = text.replace(primary_marker, helpers + primary_marker, 1)

branch_marker = '''\tlet text = currentText(state, tokens)
\tif text == "fn" || (text == "async" && tokenAt(tokens, state.index + 1).text == "fn") {'''
branch_insert = '''\tlet text = currentText(state, tokens)
\tif text == "if" {
\t\treturn parseConditionalExpression(state, tokens)
\t}
\tif text == "parallel" {
\t\treturn parseParallelExpression(state, tokens)
\t}
\tif text == "fn" || (text == "async" && tokenAt(tokens, state.index + 1).text == "fn") {'''
if branch_marker not in text:
    raise SystemExit('parsePrimary lambda marker not found')
text = text.replace(branch_marker, branch_insert, 1)
path.write_text(text)
