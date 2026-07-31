from pathlib import Path

path = Path('selfhost/mvp/src/frontend-parser-core.virune')
text = path.read_text()
if 'fn parseParenthesizedLambda(' in text:
    raise SystemExit(0)

primary_marker = 'fn parsePrimary(stateValue: CoreState, tokens: List<FrontendToken>, stopAtBrace: Bool) -> ParsedNode {'
helpers = '''fn parseLambdaPostfix(\n\tstateValue: CoreState,\n\ttokens: List<FrontendToken>,\n\tstart: Int,\n\tvalueIdValue: Int,\n) -> ParsedNode {\n\tlet mut state = stateValue\n\tlet mut valueId = valueIdValue\n\tlet mut done = false\n\twhile !done && !expressionStop(state, tokens, false) {\n\t\tif isText(state, tokens, "(") {\n\t\t\tlet callArguments = consumeBalanced(state, tokens, "(", ")", "CallArguments")\n\t\t\tstate = callArguments.state\n\t\t\tlet call = addNode(\n\t\t\t\tstate,\n\t\t\t\ttokens,\n\t\t\t\t"CallExpression",\n\t\t\t\t"call",\n\t\t\t\tstart,\n\t\t\t\tstate.index,\n\t\t\t\t[valueId, callArguments.id],\n\t\t\t\t[],\n\t\t\t)\n\t\t\tstate = call.state\n\t\t\tvalueId = call.id\n\t\t} else {\n\t\t\tdone = true\n\t\t}\n\t}\n\treturn ParsedNode { state: state, id: valueId }\n}\n\nfn parseParenthesizedLambda(\n\tstateValue: CoreState,\n\ttokens: List<FrontendToken>,\n) -> ParsedNode {\n\tlet start = stateValue.index\n\tlet mut state = advance(stateValue)\n\tlet text = currentText(state, tokens)\n\tif text != "fn" && !(text == "async" && tokenAt(tokens, state.index + 1).text == "fn") {\n\t\treturn consumeBalanced(stateValue, tokens, "(", ")", "ParenthesizedExpression")\n\t}\n\tlet inner = parseLambdaExpression(state, tokens)\n\tstate = inner.state\n\tif isText(state, tokens, ")") {\n\t\tstate = advance(state)\n\t} else {\n\t\tstate = addDiagnosticAt(state, tokens, "P0001", "Expected ) after a parenthesized lambda", state.index)\n\t}\n\tlet grouped = addNode(\n\t\tstate,\n\t\ttokens,\n\t\t"ParenthesizedExpression",\n\t\t"()",\n\t\tstart,\n\t\tstate.index,\n\t\t[inner.id],\n\t\t[],\n\t)\n\treturn parseLambdaPostfix(grouped.state, tokens, start, grouped.id)\n}\n\n'''
if primary_marker not in text:
    raise SystemExit('parsePrimary marker not found')
text = text.replace(primary_marker, helpers + primary_marker, 1)

old = '''\tif text == "(" {
\t\treturn consumeBalanced(state, tokens, "(", ")", "ParenthesizedExpression")
\t}'''
new = '''\tif text == "(" {
\t\treturn parseParenthesizedLambda(state, tokens)
\t}'''
if old not in text:
    raise SystemExit('parenthesized expression marker not found')
text = text.replace(old, new, 1)
path.write_text(text)
