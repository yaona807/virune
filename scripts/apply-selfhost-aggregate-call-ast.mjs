import { readFile, writeFile } from 'node:fs/promises';

function replaceRange(source, startMarker, endMarker, replacement) {
	const start = source.indexOf(startMarker);
	if (start < 0) throw new Error(`Missing start marker: ${startMarker}`);
	const end = source.indexOf(endMarker, start);
	if (end < 0) throw new Error(`Missing end marker: ${endMarker}`);
	return source.slice(0, start) + replacement + source.slice(end);
}

function replaceOnce(source, before, after) {
	const index = source.indexOf(before);
	if (index < 0) throw new Error(`Missing replacement target: ${before.slice(0, 80)}`);
	if (source.indexOf(before, index + 1) >= 0) throw new Error(`Replacement target is not unique: ${before.slice(0, 80)}`);
	return source.slice(0, index) + after + source.slice(index + before.length);
}

const corePath = 'selfhost/mvp/src/frontend-parser-core.virune';
let core = await readFile(corePath, 'utf8');

core = replaceOnce(
	core,
	'return isText(state, tokens, "}")\n\t\t|| isText(state, tokens, "then")',
	'return isText(state, tokens, "}")\n\t\t|| isText(state, tokens, ")")\n\t\t|| isText(state, tokens, "]")\n\t\t|| isText(state, tokens, "then")',
);

const aggregateBlock = String.raw`fn synchronizeAggregateItem(
	stateValue: CoreState,
	tokens: List<FrontendToken>,
	close: String,
) -> CoreState {
	let mut state = stateValue
	while !atEnd(state, tokens)
		&& currentKind(state, tokens) != FrontendTokenKind.NewLine
		&& !isText(state, tokens, ",")
		&& !isText(state, tokens, close) {
		state = advance(state)
	}
	return state
}

fn parseListExpression(stateValue: CoreState, tokens: List<FrontendToken>) -> ParsedNode {
	let start = stateValue.index
	let mut state = skipNewLines(advance(stateValue), tokens)
	let mut children: List<Int> = []
	while !atEnd(state, tokens) && !isText(state, tokens, "]") {
		let before = state.index
		let item = parseExpression(state, tokens, 1, false)
		state = item.state
		if item.id >= 0 {
			children = List.append(children, item.id)
		}
		if isText(state, tokens, ",") {
			state = skipNewLines(advance(state), tokens)
		} else if !isText(state, tokens, "]") {
			state = addDiagnosticAt(state, tokens, "P0001", "Expected , or ] in a list expression", state.index)
			state = synchronizeAggregateItem(state, tokens, "]")
			if isText(state, tokens, ",") {
				state = skipNewLines(advance(state), tokens)
			}
		}
		if state.index <= before {
			state = addDiagnosticAt(state, tokens, "P0001", "Parser made no progress in a list expression", state.index)
			if !atEnd(state, tokens) {
				state = advance(state)
			}
		}
	}
	if isText(state, tokens, "]") {
		state = advance(state)
	} else {
		state = addDiagnosticAt(state, tokens, "P0001", "Expected ] to end a list expression", state.index)
	}
	return addNode(state, tokens, "ListExpression", "[]", start, state.index, children, [])
}

fn parseParenthesizedOrTupleExpression(
	stateValue: CoreState,
	tokens: List<FrontendToken>,
) -> ParsedNode {
	let start = stateValue.index
	let mut state = skipNewLines(advance(stateValue), tokens)
	if isText(state, tokens, ")") {
		state = addDiagnosticAt(state, tokens, "P0001", "Expected an expression after (", state.index)
		state = advance(state)
		return addNode(state, tokens, "ParenthesizedExpression", "()", start, state.index, [], [])
	}
	let first = parseExpression(state, tokens, 1, false)
	state = first.state
	let mut children: List<Int> = []
	if first.id >= 0 {
		children = List.append(children, first.id)
	}
	if isText(state, tokens, ",") {
		let mut done = false
		while isText(state, tokens, ",") && !done {
			state = skipNewLines(advance(state), tokens)
			if isText(state, tokens, ")") {
				state = addDiagnosticAt(state, tokens, "P0001", "Expected a tuple expression after ,", state.index)
				done = true
			} else {
				let item = parseExpression(state, tokens, 1, false)
				state = item.state
				if item.id >= 0 {
					children = List.append(children, item.id)
				}
			}
		}
		if isText(state, tokens, ")") {
			state = advance(state)
		} else {
			state = addDiagnosticAt(state, tokens, "P0001", "Expected ) to end a tuple expression", state.index)
			state = synchronizeAggregateItem(state, tokens, ")")
			if isText(state, tokens, ")") {
				state = advance(state)
			}
		}
		return addNode(state, tokens, "TupleExpression", "()", start, state.index, children, [])
	}
	if isText(state, tokens, ")") {
		state = advance(state)
	} else {
		state = addDiagnosticAt(state, tokens, "P0001", "Expected ) after a parenthesized expression", state.index)
		state = synchronizeAggregateItem(state, tokens, ")")
		if isText(state, tokens, ")") {
			state = advance(state)
		}
	}
	return addNode(state, tokens, "ParenthesizedExpression", "()", start, state.index, children, [])
}

fn parseRecordEntry(stateValue: CoreState, tokens: List<FrontendToken>) -> ParsedNode {
	let start = stateValue.index
	let mut state = stateValue
	let name = currentText(state, tokens)
	if currentKind(state, tokens) == FrontendTokenKind.Identifier {
		state = advance(state)
	} else {
		state = addDiagnosticAt(state, tokens, "P0001", "Expected a record entry name", state.index)
		if !atEnd(state, tokens) {
			state = advance(state)
		}
	}
	let mut children: List<Int> = []
	if isText(state, tokens, ":") {
		let value = parseExpression(advance(state), tokens, 1, false)
		state = value.state
		if value.id >= 0 {
			children = List.append(children, value.id)
		}
	}
	return addNode(state, tokens, "RecordEntry", name, start, state.index, children, [])
}

fn parseRecordFieldBlock(stateValue: CoreState, tokens: List<FrontendToken>) -> ParsedNode {
	let start = stateValue.index
	let mut state = stateValue
	if isText(state, tokens, "{") {
		state = skipNewLines(advance(state), tokens)
	} else {
		state = addDiagnosticAt(state, tokens, "P0001", "Expected { to begin record entries", state.index)
	}
	let mut children: List<Int> = []
	while !atEnd(state, tokens) && !isText(state, tokens, "}") {
		let before = state.index
		let entry = parseRecordEntry(state, tokens)
		state = entry.state
		if entry.id >= 0 {
			children = List.append(children, entry.id)
		}
		if isText(state, tokens, ",") {
			state = skipNewLines(advance(state), tokens)
		} else if !isText(state, tokens, "}") {
			state = addDiagnosticAt(state, tokens, "P0001", "Expected , or } after a record entry", state.index)
			state = synchronizeAggregateItem(state, tokens, "}")
			if isText(state, tokens, ",") {
				state = skipNewLines(advance(state), tokens)
			} else {
				state = skipNewLines(state, tokens)
			}
		}
		if state.index <= before {
			state = addDiagnosticAt(state, tokens, "P0001", "Parser made no progress in record entries", state.index)
			if !atEnd(state, tokens) {
				state = skipNewLines(advance(state), tokens)
			}
		}
	}
	if isText(state, tokens, "}") {
		state = advance(state)
	} else {
		state = addDiagnosticAt(state, tokens, "P0001", "Expected } to end record entries", state.index)
	}
	return addNode(state, tokens, "RecordFieldBlock", "{}", start, state.index, children, [])
}

fn parseRecordExpression(
	stateValue: CoreState,
	tokens: List<FrontendToken>,
	name: String,
) -> ParsedNode {
	let start = stateValue.index
	let fields = parseRecordFieldBlock(advance(stateValue), tokens)
	return addNode(
		fields.state,
		tokens,
		"RecordExpression",
		name,
		start,
		fields.state.index,
		[fields.id],
		[],
	)
}

fn parseCallArguments(stateValue: CoreState, tokens: List<FrontendToken>) -> ParsedNode {
	let start = stateValue.index
	let mut state = skipNewLines(advance(stateValue), tokens)
	let mut children: List<Int> = []
	while !atEnd(state, tokens) && !isText(state, tokens, ")") {
		let before = state.index
		let argument = parseExpression(state, tokens, 1, false)
		state = argument.state
		if argument.id >= 0 {
			children = List.append(children, argument.id)
		}
		if isText(state, tokens, ",") {
			state = skipNewLines(advance(state), tokens)
		} else if !isText(state, tokens, ")") {
			state = addDiagnosticAt(state, tokens, "P0001", "Expected , or ) in call arguments", state.index)
			state = synchronizeAggregateItem(state, tokens, ")")
			if isText(state, tokens, ",") {
				state = skipNewLines(advance(state), tokens)
			}
		}
		if state.index <= before {
			state = addDiagnosticAt(state, tokens, "P0001", "Parser made no progress in call arguments", state.index)
			if !atEnd(state, tokens) {
				state = advance(state)
			}
		}
	}
	if isText(state, tokens, ")") {
		state = advance(state)
	} else {
		state = addDiagnosticAt(state, tokens, "P0001", "Expected ) to end call arguments", state.index)
	}
	return addNode(state, tokens, "CallArguments", "()", start, state.index, children, [])
}

fn looksLikeTypeArgumentCall(state: CoreState, tokens: List<FrontendToken>) -> Bool {
	if !isText(state, tokens, "<") {
		return false
	}
	let mut index = state.index
	let mut depth = 0
	let mut done = false
	while tokenAt(tokens, index).kind != FrontendTokenKind.EndOfFile && !done {
		let text = tokenAt(tokens, index).text
		if text == "<" {
			depth = depth + 1
		} else if text == ">" {
			depth = depth - 1
			if depth == 0 {
				index = index + 1
				done = true
				continue
			}
		}
		index = index + 1
	}
	return done && tokenAt(tokens, index).text == "("
}

fn parsePostfix(
	stateValue: CoreState,
	tokens: List<FrontendToken>,
	start: Int,
	valueIdValue: Int,
) -> ParsedNode {
	let mut state = stateValue
	let mut valueId = valueIdValue
	let mut done = false
	while !done && !expressionStop(state, tokens, false) {
		if looksLikeTypeArgumentCall(state, tokens) {
			let typeArguments = consumeBalanced(state, tokens, "<", ">", "TypeArguments")
			state = typeArguments.state
			let arguments = parseCallArguments(state, tokens)
			state = arguments.state
			let call = addNode(
				state,
				tokens,
				"CallExpression",
				"call",
				start,
				state.index,
				[valueId, typeArguments.id, arguments.id],
				[],
			)
			state = call.state
			valueId = call.id
		} else if isText(state, tokens, "(") {
			let arguments = parseCallArguments(state, tokens)
			state = arguments.state
			let call = addNode(
				state,
				tokens,
				"CallExpression",
				"call",
				start,
				state.index,
				[valueId, arguments.id],
				[],
			)
			state = call.state
			valueId = call.id
		} else if isText(state, tokens, ".") {
			state = advance(state)
			let field = currentText(state, tokens)
			if !atEnd(state, tokens) {
				state = advance(state)
			}
			let member = addNode(
				state,
				tokens,
				"FieldExpression",
				field,
				start,
				state.index,
				[valueId],
				[],
			)
			state = member.state
			valueId = member.id
		} else if isText(state, tokens, "?") {
			state = advance(state)
			let tried = addNode(
				state,
				tokens,
				"TryExpression",
				"?",
				start,
				state.index,
				[valueId],
				[],
			)
			state = tried.state
			valueId = tried.id
		} else if isText(state, tokens, "with") {
			let fields = parseRecordFieldBlock(advance(state), tokens)
			state = fields.state
			let updated = addNode(
				state,
				tokens,
				"RecordUpdateExpression",
				"with",
				start,
				state.index,
				[valueId, fields.id],
				[],
			)
			state = updated.state
			valueId = updated.id
		} else {
			done = true
		}
	}
	return ParsedNode { state: state, id: valueId }
}

fn parseLambdaPostfix(
	stateValue: CoreState,
	tokens: List<FrontendToken>,
	start: Int,
	valueIdValue: Int,
) -> ParsedNode {
	return parsePostfix(stateValue, tokens, start, valueIdValue)
}

fn parseParenthesizedLambda(
	stateValue: CoreState,
	tokens: List<FrontendToken>,
) -> ParsedNode {
	let start = stateValue.index
	let mut state = advance(stateValue)
	let text = currentText(state, tokens)
	if text != "fn" && !(text == "async" && tokenAt(tokens, state.index + 1).text == "fn") {
		let grouped = parseParenthesizedOrTupleExpression(stateValue, tokens)
		return parsePostfix(grouped.state, tokens, start, grouped.id)
	}
	let inner = parseLambdaExpression(state, tokens)
	state = inner.state
	if isText(state, tokens, ")") {
		state = advance(state)
	} else {
		state = addDiagnosticAt(state, tokens, "P0001", "Expected ) after a parenthesized lambda", state.index)
	}
	let grouped = addNode(
		state,
		tokens,
		"ParenthesizedExpression",
		"()",
		start,
		state.index,
		[inner.id],
		[],
	)
	return parseLambdaPostfix(grouped.state, tokens, start, grouped.id)
}

fn parseControlPostfix(
	stateValue: CoreState,
	tokens: List<FrontendToken>,
	start: Int,
	valueIdValue: Int,
) -> ParsedNode {
	return parsePostfix(stateValue, tokens, start, valueIdValue)
}

`;

core = replaceRange(core, 'fn parseLambdaPostfix(', 'fn parseConditionalExpression(', aggregateBlock + 'fn parseConditionalExpression(');

const primary = String.raw`fn parsePrimary(stateValue: CoreState, tokens: List<FrontendToken>, stopAtBrace: Bool) -> ParsedNode {
	let mut state = stateValue
	let start = state.index
	if expressionStop(state, tokens, stopAtBrace) {
		state = addDiagnosticAt(state, tokens, "P0001", "Expected an expression", state.index)
		return ParsedNode { state: state, id: -1 }
	}
	let text = currentText(state, tokens)
	if text == "if" {
		return parseConditionalExpression(state, tokens)
	}
	if text == "parallel" {
		return parseParallelExpression(state, tokens)
	}
	if text == "fn" || (text == "async" && tokenAt(tokens, state.index + 1).text == "fn") {
		return parseLambdaExpression(state, tokens)
	}
	if text == "match" {
		return parseMatchExpression(state, tokens)
	}
	if text == "!" || text == "-" || text == "await" {
		state = advance(state)
		let operand = parsePrimary(state, tokens, stopAtBrace)
		return addNode(
			operand.state,
			tokens,
			"UnaryExpression",
			text,
			start,
			operand.state.index,
			[operand.id],
			[],
		)
	}
	if text == "(" {
		return parseParenthesizedLambda(state, tokens)
	}
	if text == "[" {
		let list = parseListExpression(state, tokens)
		return parsePostfix(list.state, tokens, start, list.id)
	}
	if currentKind(state, tokens) == FrontendTokenKind.Identifier
		&& tokenAt(tokens, state.index + 1).text == "{"
		&& !stopAtBrace {
		let record = parseRecordExpression(state, tokens, text)
		return parsePostfix(record.state, tokens, start, record.id)
	}
	let kind = if currentKind(state, tokens) == FrontendTokenKind.Identifier then "IdentifierExpression" else "LiteralExpression"
	state = advance(state)
	let added = addNode(state, tokens, kind, text, start, state.index, [], [])
	return parsePostfix(added.state, tokens, start, added.id)
}

`;

core = replaceRange(core, 'fn parsePrimary(', 'fn parseExpression(', primary + 'fn parseExpression(');
await writeFile(corePath, core);

const hostTest = String.raw`import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildProject } from '../src/project/project.js';

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const mvpRoot = join(repositoryRoot, 'selfhost', 'mvp');
const temporaryRoot = join(repositoryRoot, '.test-tmp');

type ViruneResult<T> = { readonly $tag: 'Ok' | 'Err'; readonly $values: readonly [T] };
type Position = { readonly offset: number; readonly line: number; readonly column: number };
type Span = { readonly start: Position; readonly end: Position };
type ParserDiagnostic = { readonly code: string; readonly severity: string; readonly message: string; readonly span: Span };
type AstNode = {
	readonly id: number;
	readonly kind: string;
	readonly text: string;
	readonly span: Span;
	readonly children: readonly number[];
	readonly documentation: readonly string[];
};
type ParseResult = {
	readonly accepted: boolean;
	readonly root: number;
	readonly nodes: readonly AstNode[];
	readonly diagnostics: readonly ParserDiagnostic[];
};
type FrontendParserModule = {
	readonly parseFrontendContract: (source: string) => ViruneResult<string>;
};

const aggregateSource = [
	'pub fn aggregate(value: Int, y: Int) -> Int {',
	'\tlet list = [1, value + 1, y,]',
	'\tlet grouped = (value + 1)',
	'\tlet tuple = (value, y)',
	'\tlet point = Point { x: value, y, }',
	'\tlet called = build<Result<Int>>(point, list,)',
	'\tlet updated = point with { x: called, y, }',
	'\tdiscard grouped',
	'\tdiscard tuple',
	'\tdiscard updated',
	'\treturn called',
	'}',
	'',
].join('\n');

test('aggregate parser emits detailed list, tuple, record, call, and update nodes', async () => {
	const loaded = await loadFrontendParser();
	try {
		const first = parse(loaded.module, aggregateSource);
		const second = parse(loaded.module, aggregateSource);
		assert.deepEqual(first, second);
		assert.equal(first.accepted, true);
		assert.deepEqual(first.diagnostics, []);
		assert.deepEqual(first.nodes.map(item => item.id), first.nodes.map((_, index) => index));
		for (const node of first.nodes) {
			for (const child of node.children) assert.ok(child >= 0 && child < first.nodes.length);
		}

		const list = first.nodes.find(item => item.kind === 'ListExpression');
		assert.ok(list);
		assert.equal(list.children.length, 3);
		const grouped = first.nodes.find(item => item.kind === 'ParenthesizedExpression');
		assert.ok(grouped);
		assert.equal(grouped.children.length, 1);
		const tuple = first.nodes.find(item => item.kind === 'TupleExpression');
		assert.ok(tuple);
		assert.equal(tuple.children.length, 2);
		const record = first.nodes.find(item => item.kind === 'RecordExpression' && item.text === 'Point');
		assert.ok(record);
		assert.equal(record.children.length, 1);
		const entries = first.nodes.filter(item => item.kind === 'RecordEntry');
		assert.ok(entries.some(item => item.text === 'x' && item.children.length === 1));
		assert.ok(entries.some(item => item.text === 'y' && item.children.length === 0));
		const typedCall = first.nodes.find(item => item.kind === 'CallExpression' && item.children.length === 3);
		assert.ok(typedCall);
		assert.ok(first.nodes.some(item => item.kind === 'TypeArguments'));
		const callArguments = first.nodes.find(item => item.kind === 'CallArguments' && item.children.length === 2);
		assert.ok(callArguments);
		const update = first.nodes.find(item => item.kind === 'RecordUpdateExpression');
		assert.ok(update);
		assert.equal(update.children.length, 2);
	} finally {
		await rm(loaded.root, { recursive: true, force: true });
	}
});

test('aggregate parser recovers at item boundaries and reaches a following declaration', async () => {
	const loaded = await loadFrontendParser();
	try {
		const source = [
			'pub fn broken() -> Int {',
			'\tlet list = [1,,2,]',
			'\tlet point = Point { broken 1, valid: 2, }',
			'\tlet called = make(1,,2,)',
			'\treturn 0',
			'}',
			'pub fn after() -> Int {',
			'\treturn 1',
			'}',
			'',
		].join('\n');
		const result = parse(loaded.module, source);
		assert.equal(result.accepted, false);
		assert.ok(result.diagnostics.length >= 3);
		assert.ok(result.nodes.some(item => item.kind === 'RecordEntry' && item.text === 'valid'));
		assert.ok(result.nodes.some(item => item.kind === 'FunctionDeclaration' && item.text === 'after'));
	} finally {
		await rm(loaded.root, { recursive: true, force: true });
	}
});

function parse(module: FrontendParserModule, source: string): ParseResult {
	const encoded = module.parseFrontendContract(source);
	if (encoded.$tag !== 'Ok') {
		throw new Error(`Frontend parser contract failed: ${JSON.stringify(encoded.$values[0])}`);
	}
	return JSON.parse(encoded.$values[0]) as ParseResult;
}

async function loadFrontendParser(): Promise<{ readonly root: string; readonly module: FrontendParserModule }> {
	const result = await buildProject(mvpRoot, { write: false });
	const errors = result.diagnostics.filter(item => item.severity === 'error');
	assert.deepEqual(errors.map(item => `${item.code}:${item.message}`), []);

	await mkdir(temporaryRoot, { recursive: true });
	const root = await mkdtemp(join(temporaryRoot, 'selfhost-aggregate-call-expression-ast-'));
	const configuredOutDir = resolve(mvpRoot, 'dist');
	const outputPaths: string[] = [];
	for (const built of result.modules) {
		if (built.output === undefined || built.outputPath === undefined) continue;
		const outputPath = join(root, relative(configuredOutDir, built.outputPath));
		await mkdir(dirname(outputPath), { recursive: true });
		await writeFile(outputPath, built.output.code);
		outputPaths.push(outputPath);
	}
	for (const outputPath of outputPaths.sort()) await execFileAsync(process.execPath, ['--check', outputPath]);
	const moduleUrl = `${pathToFileURL(join(root, 'main.js')).href}?test=${Date.now()}`;
	return { root, module: await import(moduleUrl) as FrontendParserModule };
}
`;
await writeFile('packages/compiler/test/selfhost-aggregate-call-expression-ast.test.ts', hostTest);

const stageZero = String.raw`import { parseFrontendCore } from "./frontend-parser-core.virune"

fn encoded(source: String) -> String {
	return match parseFrontendCore(source) {
		Ok(value) => value
		Err(_) => ""
	}
}

test "aggregate parser expands list tuple record call and update expressions" {
	let source = "pub fn aggregate(value: Int, y: Int) -> Int {\n\tlet list = [1, value + 1, y,]\n\tlet grouped = (value + 1)\n\tlet tuple = (value, y)\n\tlet point = Point { x: value, y, }\n\tlet called = build<Result<Int>>(point, list,)\n\tlet updated = point with { x: called, y, }\n\treturn called\n}\n"
	let result = encoded(source)
	expect(String.contains(result, "\"accepted\":true"))
	expect(String.contains(result, "\"kind\":\"ListExpression\""))
	expect(String.contains(result, "\"kind\":\"ParenthesizedExpression\""))
	expect(String.contains(result, "\"kind\":\"TupleExpression\""))
	expect(String.contains(result, "\"kind\":\"RecordExpression\""))
	expect(String.contains(result, "\"kind\":\"RecordEntry\""))
	expect(String.contains(result, "\"kind\":\"TypeArguments\""))
	expect(String.contains(result, "\"kind\":\"CallArguments\""))
	expect(String.contains(result, "\"kind\":\"RecordUpdateExpression\""))
}

test "aggregate parser recovers after malformed items" {
	let source = "pub fn broken() -> Int {\n\tlet list = [1,,2,]\n\tlet point = Point { broken 1, valid: 2, }\n\tlet called = make(1,,2,)\n\treturn 0\n}\npub fn after() -> Int {\n\treturn 1\n}\n"
	let result = encoded(source)
	expect(String.contains(result, "\"accepted\":false"))
	expect(String.contains(result, "\"text\":\"valid\""))
	expect(String.contains(result, "\"text\":\"after\""))
}
`;
await writeFile('selfhost/mvp/src/frontend-aggregate-call-expression.spec.virune', stageZero);

const englishPath = 'docs/self-hosting-frontend.md';
let english = await readFile(englishPath, 'utf8');
if (!english.includes('## Aggregate and call expressions')) {
	english += String.raw`

## Aggregate and call expressions

The Parser core expands list items, parenthesized and tuple expressions, record entries, call arguments, optional call type arguments, and record-update entries into canonical flat-arena nodes. Shorthand record entries remain distinguishable from explicit value entries by their child count, while call and update containers reference only valid canonical node IDs.

Comma-delimited recovery synchronizes at the next comma, closing delimiter, physical line end, or enclosing record brace. Trailing commas are accepted where the Virune 1.0 grammar permits them, nested aggregates reuse the same precedence-aware expression path, and progress guards prevent malformed item lists from hanging. Semantic arity and record-field validation remain later Type/Effect Checker work.
`;
	await writeFile(englishPath, english);
}

const japanesePath = 'docs/self-hosting-frontend_ja.md';
let japanese = await readFile(japanesePath, 'utf8');
if (!japanese.includes('## Aggregate expressionとcall expression')) {
	japanese += String.raw`

## Aggregate expressionとcall expression

Parser coreはlist item、parenthesized／tuple expression、record entry、call argument、任意のcall type argument、record-update entryをcanonical flat-arena nodeへ詳細化します。Shorthand record entryと明示value entryはchild数で区別でき、callとupdateのcontainerは有効なcanonical node IDだけを参照します。

Comma区切りのrecoveryは次のcomma、closing delimiter、物理line end、または囲んでいるrecord braceで同期します。Virune 1.0 grammarが許可する位置ではtrailing commaを受理し、nested aggregateは同じprecedence-aware expression pathを再利用し、progress guardによりmalformed item listでParserが停止し続けることを防ぎます。Semantic arityとrecord-field validationは後続のType／Effect Checkerで扱います。
`;
	await writeFile(japanesePath, japanese);
}
