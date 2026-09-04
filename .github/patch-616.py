from pathlib import Path

host_path = Path('packages/compiler/src/syntax/tokens.ts')
selfhost_path = Path('selfhost/mvp/src/frontend-lexer.virune')

host = host_path.read_text()
host_old = '''function normalizeNewLines(input: readonly IToken[]): IToken[] {
\tconst output: IToken[] = [];
\tlet parenDepth = 0;
\tlet bracketDepth = 0;
\tlet braceDepth = 0;
\tfor (let index = 0; index < input.length; index++) {
\t\tconst token = input[index]!;
\t\tconst name = token.tokenType.name;
\t\tif (name === 'NewLine') {
\t\t\tconst previous = output.at(-1);
\t\t\tconst next = input.slice(index + 1).find(item => item.tokenType.name !== 'NewLine');
\t\t\tconst topLevelDeclarationBoundary = braceDepth === 0
\t\t\t\t&& previous?.tokenType.name === 'Greater'
\t\t\t\t&& (next === undefined || topLevelDeclarationStarts.has(next.tokenType.name));
\t\t\tconst soft = parenDepth > 0
\t\t\t\t|| bracketDepth > 0
\t\t\t\t|| (!topLevelDeclarationBoundary && previous !== undefined && softAfter.has(previous.tokenType.name))
\t\t\t\t|| (next !== undefined && softBefore.has(next.tokenType.name));
\t\t\tif (!soft && previous?.tokenType.name !== 'NewLine') output.push(token);
\t\t\tcontinue;
\t\t}
\t\toutput.push(token);
\t\tif (name === 'LParen') parenDepth++; else if (name === 'RParen') parenDepth = Math.max(0, parenDepth - 1);
\t\tif (name === 'LBracket') bracketDepth++; else if (name === 'RBracket') bracketDepth = Math.max(0, bracketDepth - 1);
\t\tif (name === 'LBrace') braceDepth++; else if (name === 'RBrace') braceDepth = Math.max(0, braceDepth - 1);
\t}
\treturn output;
}
'''
host_new = '''interface LambdaBlockScope {
\treadonly bodyBraceDepth: number;
\treadonly floorParenDepth: number;
\treadonly floorBracketDepth: number;
}

function previousNonNewLineIndex(input: readonly IToken[], startIndex: number): number | undefined {
\tfor (let index = startIndex; index >= 0; index--) {
\t\tif (input[index]?.tokenType.name !== 'NewLine') return index;
\t}
\treturn undefined;
}

function matchingOpenParenIndex(input: readonly IToken[], closeIndex: number): number | undefined {
\tlet depth = 0;
\tfor (let index = closeIndex; index >= 0; index--) {
\t\tconst name = input[index]?.tokenType.name;
\t\tif (name === 'RParen') depth++;
\t\telse if (name === 'LParen') {
\t\t\tdepth--;
\t\t\tif (depth === 0) return index;
\t\t}
\t}
\treturn undefined;
}

function isBlockLambdaOpeningBrace(input: readonly IToken[], braceIndex: number): boolean {
\tlet index = braceIndex - 1;
\tlet angleDepth = 0;
\tlet sawTopLevelComma = false;
\tlet sawUses = false;
\twhile (index >= 0) {
\t\tconst token = input[index]!;
\t\tconst name = token.tokenType.name;
\t\tif (name === 'NewLine') { index--; continue; }
\t\tif (name === 'Greater') { angleDepth++; index--; continue; }
\t\tif (name === 'Less' && angleDepth > 0) { angleDepth--; index--; continue; }
\t\tif (angleDepth > 0) { index--; continue; }
\t\tif (name === 'RParen') {
\t\t\tconst openIndex = matchingOpenParenIndex(input, index);
\t\t\tif (openIndex === undefined) return false;
\t\t\tconst beforeIndex = previousNonNewLineIndex(input, openIndex - 1);
\t\t\tif (beforeIndex !== undefined && input[beforeIndex]?.tokenType.name === 'KwFn') return !sawTopLevelComma || sawUses;
\t\t\tindex = openIndex - 1;
\t\t\tcontinue;
\t\t}
\t\tif (name === 'KwUses') sawUses = true;
\t\telse if (name === 'Comma') sawTopLevelComma = true;
\t\telse if (name === 'FatArrow' || name === 'Equals' || name === 'Colon' || name === 'LBrace' || name === 'RBrace' || name === 'RBracket') return false;
\t\tindex--;
\t}
\treturn false;
}

function normalizeNewLines(input: readonly IToken[]): IToken[] {
\tconst output: IToken[] = [];
\tconst lambdaBlockScopes: LambdaBlockScope[] = [];
\tlet parenDepth = 0;
\tlet bracketDepth = 0;
\tlet braceDepth = 0;
\tfor (let index = 0; index < input.length; index++) {
\t\tconst token = input[index]!;
\t\tconst name = token.tokenType.name;
\t\tif (name === 'NewLine') {
\t\t\tconst previous = output.at(-1);
\t\t\tconst next = input.slice(index + 1).find(item => item.tokenType.name !== 'NewLine');
\t\t\tconst topLevelDeclarationBoundary = braceDepth === 0
\t\t\t\t&& previous?.tokenType.name === 'Greater'
\t\t\t\t&& (next === undefined || topLevelDeclarationStarts.has(next.tokenType.name));
\t\t\tconst scope = lambdaBlockScopes.at(-1);
\t\t\tconst structuralSoft = scope === undefined
\t\t\t\t? parenDepth > 0 || bracketDepth > 0
\t\t\t\t: parenDepth > scope.floorParenDepth || bracketDepth > scope.floorBracketDepth;
\t\t\tconst soft = structuralSoft
\t\t\t\t|| (!topLevelDeclarationBoundary && previous !== undefined && softAfter.has(previous.tokenType.name))
\t\t\t\t|| (next !== undefined && softBefore.has(next.tokenType.name));
\t\t\tif (!soft && previous?.tokenType.name !== 'NewLine') output.push(token);
\t\t\tcontinue;
\t\t}
\t\tconst opensLambdaBlock = name === 'LBrace' && isBlockLambdaOpeningBrace(input, index);
\t\toutput.push(token);
\t\tif (name === 'LParen') parenDepth++; else if (name === 'RParen') parenDepth = Math.max(0, parenDepth - 1);
\t\tif (name === 'LBracket') bracketDepth++; else if (name === 'RBracket') bracketDepth = Math.max(0, bracketDepth - 1);
\t\tif (name === 'LBrace') {
\t\t\tbraceDepth++;
\t\t\tif (opensLambdaBlock) lambdaBlockScopes.push({ bodyBraceDepth: braceDepth, floorParenDepth: parenDepth, floorBracketDepth: bracketDepth });
\t\t} else if (name === 'RBrace') {
\t\t\tbraceDepth = Math.max(0, braceDepth - 1);
\t\t\twhile (lambdaBlockScopes.length > 0 && lambdaBlockScopes[lambdaBlockScopes.length - 1]!.bodyBraceDepth > braceDepth) lambdaBlockScopes.pop();
\t\t}
\t}
\treturn output;
}
'''
if host.count(host_old) != 1:
    raise SystemExit('host normalizeNewLines anchor mismatch')
host_path.write_text(host.replace(host_old, host_new))

selfhost = selfhost_path.read_text()
selfhost_old = '''fn normalizeNewLines(rawTokens: List<FrontendToken>) -> List<FrontendToken> {
\tlet mut result: List<FrontendToken> = []
\tlet mut parenDepth = 0
\tlet mut bracketDepth = 0
\tlet mut braceDepth = 0
\tlet mut index = 0
\twhile index < List.length(rawTokens) {
\t\tlet value = tokenAt(rawTokens, index)
\t\tif value.kind == FrontendTokenKind.NewLine {
\t\t\tlet previous = previousNonNewLine(result)
\t\t\tlet next = nextNonNewLine(rawTokens, index + 1)
\t\t\tlet previousText = match previous { Some(item) => item.text, None => "" }
\t\t\tlet nextText = match next { Some(item) => item.text, None => "" }
\t\t\tlet structuralSoft = parenDepth > 0 || bracketDepth > 0
\t\t\tlet continuationSoft = softAfter(previousText) || softBefore(nextText)
\t\t\tif !(structuralSoft || continuationSoft) || retainGenericDeclarationBreak(previous, next, braceDepth) {
\t\t\t\tresult = List.append(result, value)
\t\t\t}
\t\t\tindex = index + 1
\t\t\tcontinue
\t\t}
\t\tif value.text == "(" {
\t\t\tparenDepth = parenDepth + 1
\t\t} else if value.text == ")" && parenDepth > 0 {
\t\t\tparenDepth = parenDepth - 1
\t\t} else if value.text == "[" {
\t\t\tbracketDepth = bracketDepth + 1
\t\t} else if value.text == "]" && bracketDepth > 0 {
\t\t\tbracketDepth = bracketDepth - 1
\t\t} else if value.text == "{" {
\t\t\tbraceDepth = braceDepth + 1
\t\t} else if value.text == "}" && braceDepth > 0 {
\t\t\tbraceDepth = braceDepth - 1
\t\t}
\t\tresult = List.append(result, value)
\t\tindex = index + 1
\t}
\treturn result
}
'''
selfhost_new = '''fn previousNonNewLineIndex(tokens: List<FrontendToken>, startIndex: Int) -> Int? {
\tlet mut index = startIndex
\twhile index >= 0 {
\t\tif tokenAt(tokens, index).kind != FrontendTokenKind.NewLine {
\t\t\treturn Some(index)
\t\t}
\t\tindex = index - 1
\t}
\treturn None
}

fn matchingOpenParenIndex(tokens: List<FrontendToken>, closeIndex: Int) -> Int? {
\tlet mut depth = 0
\tlet mut index = closeIndex
\twhile index >= 0 {
\t\tlet text = tokenAt(tokens, index).text
\t\tif text == ")" {
\t\t\tdepth = depth + 1
\t\t} else if text == "(" {
\t\t\tdepth = depth - 1
\t\t\tif depth == 0 {
\t\t\t\treturn Some(index)
\t\t\t}
\t\t}
\t\tindex = index - 1
\t}
\treturn None
}

fn isBlockLambdaOpeningBrace(tokens: List<FrontendToken>, braceIndex: Int) -> Bool {
\tlet mut index = braceIndex - 1
\tlet mut angleDepth = 0
\tlet mut sawTopLevelComma = false
\tlet mut sawUses = false
\twhile index >= 0 {
\t\tlet value = tokenAt(tokens, index)
\t\tif value.kind == FrontendTokenKind.NewLine {
\t\t\tindex = index - 1
\t\t\tcontinue
\t\t}
\t\tif value.text == ">" {
\t\t\tangleDepth = angleDepth + 1
\t\t\tindex = index - 1
\t\t\tcontinue
\t\t}
\t\tif value.text == "<" && angleDepth > 0 {
\t\t\tangleDepth = angleDepth - 1
\t\t\tindex = index - 1
\t\t\tcontinue
\t\t}
\t\tif angleDepth > 0 {
\t\t\tindex = index - 1
\t\t\tcontinue
\t\t}
\t\tif value.text == ")" {
\t\t\tlet openIndex = matchingOpenParenIndex(tokens, index)
\t\t\tmatch openIndex {
\t\t\t\tSome(open) => {
\t\t\t\t\tlet beforeIndex = previousNonNewLineIndex(tokens, open - 1)
\t\t\t\t\tmatch beforeIndex {
\t\t\t\t\t\tSome(before) => {
\t\t\t\t\t\t\tif tokenAt(tokens, before).text == "fn" {
\t\t\t\t\t\t\t\treturn !sawTopLevelComma || sawUses
\t\t\t\t\t\t\t}
\t\t\t\t\t\t}
\t\t\t\t\t\tNone => Unit
\t\t\t\t\t}
\t\t\t\t\tindex = open - 1
\t\t\t\t\tcontinue
\t\t\t\t}
\t\t\t\tNone => return false
\t\t\t}
\t\t}
\t\tif value.text == "uses" {
\t\t\tsawUses = true
\t\t} else if value.text == "," {
\t\t\tsawTopLevelComma = true
\t\t} else if value.text == "=>" || value.text == "=" || value.text == ":" || value.text == "{" || value.text == "}" || value.text == "]" {
\t\t\treturn false
\t\t}
\t\tindex = index - 1
\t}
\treturn false
}

fn withoutLastInt(values: List<Int>) -> List<Int> {
\tlet mut result: List<Int> = []
\tlet mut index = 0
\twhile index + 1 < List.length(values) {
\t\tmatch List.get(values, index) {
\t\t\tSome(value) => result = List.append(result, value)
\t\t\tNone => Unit
\t\t}
\t\tindex = index + 1
\t}
\treturn result
}

fn lastIntOr(values: List<Int>, fallback: Int) -> Int {
\treturn match List.last(values) {
\t\tSome(value) => value
\t\tNone => fallback
\t}
}

fn normalizeNewLines(rawTokens: List<FrontendToken>) -> List<FrontendToken> {
\tlet mut result: List<FrontendToken> = []
\tlet mut lambdaBraceDepths: List<Int> = []
\tlet mut lambdaParenFloors: List<Int> = []
\tlet mut lambdaBracketFloors: List<Int> = []
\tlet mut parenDepth = 0
\tlet mut bracketDepth = 0
\tlet mut braceDepth = 0
\tlet mut index = 0
\twhile index < List.length(rawTokens) {
\t\tlet value = tokenAt(rawTokens, index)
\t\tif value.kind == FrontendTokenKind.NewLine {
\t\t\tlet previous = previousNonNewLine(result)
\t\t\tlet next = nextNonNewLine(rawTokens, index + 1)
\t\t\tlet previousText = match previous { Some(item) => item.text, None => "" }
\t\t\tlet nextText = match next { Some(item) => item.text, None => "" }
\t\t\tlet lambdaActive = List.length(lambdaBraceDepths) > 0
\t\t\tlet structuralSoft = if lambdaActive then parenDepth > lastIntOr(lambdaParenFloors, 0) || bracketDepth > lastIntOr(lambdaBracketFloors, 0) else parenDepth > 0 || bracketDepth > 0
\t\t\tlet continuationSoft = softAfter(previousText) || softBefore(nextText)
\t\t\tif !(structuralSoft || continuationSoft) || retainGenericDeclarationBreak(previous, next, braceDepth) {
\t\t\t\tresult = List.append(result, value)
\t\t\t}
\t\t\tindex = index + 1
\t\t\tcontinue
\t\t}
\t\tlet opensLambdaBlock = value.text == "{" && isBlockLambdaOpeningBrace(rawTokens, index)
\t\tif value.text == "(" {
\t\t\tparenDepth = parenDepth + 1
\t\t} else if value.text == ")" && parenDepth > 0 {
\t\t\tparenDepth = parenDepth - 1
\t\t} else if value.text == "[" {
\t\t\tbracketDepth = bracketDepth + 1
\t\t} else if value.text == "]" && bracketDepth > 0 {
\t\t\tbracketDepth = bracketDepth - 1
\t\t} else if value.text == "{" {
\t\t\tbraceDepth = braceDepth + 1
\t\t\tif opensLambdaBlock {
\t\t\t\tlambdaBraceDepths = List.append(lambdaBraceDepths, braceDepth)
\t\t\t\tlambdaParenFloors = List.append(lambdaParenFloors, parenDepth)
\t\t\t\tlambdaBracketFloors = List.append(lambdaBracketFloors, bracketDepth)
\t\t\t}
\t\t} else if value.text == "}" && braceDepth > 0 {
\t\t\tbraceDepth = braceDepth - 1
\t\t\twhile List.length(lambdaBraceDepths) > 0 && lastIntOr(lambdaBraceDepths, 0) > braceDepth {
\t\t\t\tlambdaBraceDepths = withoutLastInt(lambdaBraceDepths)
\t\t\t\tlambdaParenFloors = withoutLastInt(lambdaParenFloors)
\t\t\t\tlambdaBracketFloors = withoutLastInt(lambdaBracketFloors)
\t\t\t}
\t\t}
\t\tresult = List.append(result, value)
\t\tindex = index + 1
\t}
\treturn result
}
'''
if selfhost.count(selfhost_old) != 1:
    raise SystemExit('selfhost normalizeNewLines anchor mismatch')
selfhost_path.write_text(selfhost.replace(selfhost_old, selfhost_new))
