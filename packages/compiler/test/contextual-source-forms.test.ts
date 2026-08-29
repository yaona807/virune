import assert from 'node:assert/strict';
import test from 'node:test';
import { compileSource } from '../src/compiler.js';

const source = (text: string) => ({ id: 1, path: 'test.virune', text });

function errorCodes(result: ReturnType<typeof compileSource>): string[] {
	return result.diagnostics.filter(item => item.severity === 'error').map(item => item.code);
}

function functionBody(text: string) {
	const result = compileSource(source(text), { emit: false });
	const declaration = result.ast?.declarations.find(item => item.kind === 'FunctionDeclaration');
	assert.equal(declaration?.kind, 'FunctionDeclaration');
	assert.equal(declaration?.body.kind, 'BlockStatement');
	if (declaration?.kind !== 'FunctionDeclaration' || declaration.body.kind !== 'BlockStatement') throw new Error('expected function block');
	return { result, body: declaration.body };
}

// @virune-rule {"id":"eval.contextual-source-forms","runner":"unit","file":"packages/compiler/test/contextual-source-forms.test.ts","case":"contextual aggregate syntax is distinct from named native record construction","kind":"negative","platform":"common"}
test('contextual aggregate syntax is distinct from named native record construction', () => {
	const contextual = functionBody(`fn build() {
	discard {
		timeout: 3000,
		retry: { count: 3 },
		__proto__: 1,
	}
}
`);
	const statement = contextual.body.statements[0];
	assert.equal(statement?.kind, 'DiscardStatement');
	if (statement?.kind !== 'DiscardStatement') return;
	assert.equal(statement.expression.kind, 'ContextualAggregateExpression');
	if (statement.expression.kind !== 'ContextualAggregateExpression') return;
	assert.deepEqual(statement.expression.entries.map(entry => entry.name), ['timeout', 'retry', '__proto__']);
	assert.equal(statement.expression.entries[1]?.value.kind, 'ContextualAggregateExpression');
	assert.ok(errorCodes(contextual.result).includes('L2122'), 'unresolved contextual aggregate must fail closed until a semantic facet accepts it');

	const nativeRecord = functionBody(`record Config {
	timeout: Int
}

fn build() -> Config {
	return Config { timeout: 3000 }
}
`);
	const returnStatement = nativeRecord.body.statements[0];
	assert.equal(returnStatement?.kind, 'ReturnStatement');
	if (returnStatement?.kind !== 'ReturnStatement') return;
	assert.equal(returnStatement.value?.kind, 'RecordExpression');
	assert.deepEqual(errorCodes(nativeRecord.result), []);
});

test('duplicate contextual aggregate fields are diagnosed without weakening fail-closed semantics', () => {
	const { result } = functionBody(`fn build() {
	discard { retry: 1, retry: 2 }
}
`);
	const codes = errorCodes(result);
	assert.ok(codes.includes('L2025'));
	assert.ok(codes.includes('L2122'));
});

test('contextual aggregate spans cover complete source forms', () => {
	const text = `fn build() {
	discard { first: 1, second: 2 }
	discard {}
}
`;
	const { body } = functionBody(text);
	const populatedStatement = body.statements[0];
	assert.equal(populatedStatement?.kind, 'DiscardStatement');
	if (populatedStatement?.kind !== 'DiscardStatement' || populatedStatement.expression.kind !== 'ContextualAggregateExpression') return;
	assert.equal(text.slice(populatedStatement.expression.span.start.offset, populatedStatement.expression.span.end.offset), '{ first: 1, second: 2 }');
	assert.deepEqual(
		populatedStatement.expression.entries.map(entry => text.slice(entry.span.start.offset, entry.span.end.offset)),
		['first: 1', 'second: 2'],
	);
	const emptyStatement = body.statements[1];
	assert.equal(emptyStatement?.kind, 'DiscardStatement');
	if (emptyStatement?.kind !== 'DiscardStatement' || emptyStatement.expression.kind !== 'ContextualAggregateExpression') return;
	assert.equal(text.slice(emptyStatement.expression.span.start.offset, emptyStatement.expression.span.end.offset), '{}');
});

// @virune-rule {"id":"eval.contextual-source-forms","runner":"unit","file":"packages/compiler/test/contextual-source-forms.test.ts","case":"postfix index syntax preserves receiver and key expressions","kind":"negative","platform":"common"}
test('postfix index syntax preserves receiver and key expressions', () => {
	const { result, body } = functionBody(`fn read(row: Unknown, key: String) {
	discard row[key]
}
`);
	const statement = body.statements[0];
	assert.equal(statement?.kind, 'DiscardStatement');
	if (statement?.kind !== 'DiscardStatement') return;
	assert.equal(statement.expression.kind, 'IndexExpression');
	if (statement.expression.kind !== 'IndexExpression') return;
	assert.equal(statement.expression.target.kind, 'IdentifierExpression');
	assert.equal(statement.expression.index.kind, 'IdentifierExpression');
	assert.ok(errorCodes(result).includes('L2121'), 'indexing without a proven index facet must fail closed');
});

// @virune-rule {"id":"eval.contextual-source-forms","runner":"unit","file":"packages/compiler/test/contextual-source-forms.test.ts","case":"member and index assignment have explicit AST targets while identifier assignment stays unchanged","kind":"negative","platform":"common"}
test('member and index assignment have explicit AST targets while identifier assignment stays unchanged', () => {
	const { result, body } = functionBody(`fn write(target: Unknown, key: String) {
	let mut local = 1
	local = 2
	target.value = 3
	target[key] = 4
}
`);
	assert.equal(body.statements[1]?.kind, 'AssignmentStatement');
	assert.equal(body.statements[2]?.kind, 'MemberAssignmentStatement');
	assert.equal(body.statements[3]?.kind, 'IndexAssignmentStatement');
	const member = body.statements[2];
	if (member?.kind === 'MemberAssignmentStatement') {
		assert.equal(member.target.kind, 'IdentifierExpression');
		assert.equal(member.field, 'value');
	}
	const index = body.statements[3];
	if (index?.kind === 'IndexAssignmentStatement') {
		assert.equal(index.target.kind, 'IdentifierExpression');
		assert.equal(index.index.kind, 'IdentifierExpression');
	}
	const codes = errorCodes(result);
	assert.ok(codes.includes('L2119'), 'member assignment without a writable facet must fail closed');
	assert.ok(codes.includes('L2120'), 'index assignment without a writable facet must fail closed');
});

test('identifier assignment preserves the pre-existing assignment span contract', () => {
	const { result, body } = functionBody(`fn write() {
	let local = 1
	local = 2
}
`);
	const statement = body.statements[1];
	assert.equal(statement?.kind, 'AssignmentStatement');
	if (statement?.kind !== 'AssignmentStatement') return;
	assert.deepEqual(statement.span, statement.value.span);
	const immutable = result.diagnostics.find(item => item.code === 'L2010');
	assert.ok(immutable);
	assert.deepEqual(immutable.span, statement.value.span);
});

test('assignment lookahead has no token-count cutoff', () => {
	const chain = Array.from({ length: 80 }, (_, index) => `.field${index}`).join('');
	const { result, body } = functionBody(`fn write(target: Unknown) {
	target${chain}.value = 1
}
`);
	assert.equal(body.statements[0]?.kind, 'MemberAssignmentStatement');
	const codes = errorCodes(result);
	assert.ok(codes.includes('L2119'));
	assert.ok(!codes.includes('L0002'), 'long assignment targets must not be reclassified as expression statements');
});

test('assignment detection stops at the current line', () => {
	const { result, body } = functionBody(`fn write(target: Unknown) {
	target.value
	target.value = 1
}
`);
	assert.equal(body.statements[0]?.kind, 'ExpressionStatement');
	assert.equal(body.statements[1]?.kind, 'MemberAssignmentStatement');
	assert.ok(!errorCodes(result).includes('L0002'), 'an equals token on the next line must not reclassify the previous expression statement');
});

test('existing block list-pattern and record-update syntax retain their AST forms', () => {
	const { result, body } = functionBody(`record Config {
	value: Int
}

fn preserve(config: Config) {
	let values = [1, 2]
	discard match values {
		[first, ...rest] => first
	}
	discard config with { value: 2 }
}
`);
	assert.ok(!errorCodes(result).includes('L0002'));
	assert.equal(body.statements[0]?.kind, 'LetStatement');
	const values = body.statements[0];
	if (values?.kind === 'LetStatement') assert.equal(values.value.kind, 'ListExpression');
	const matchStatement = body.statements[1];
	assert.equal(matchStatement?.kind, 'DiscardStatement');
	if (matchStatement?.kind === 'DiscardStatement' && matchStatement.expression.kind === 'MatchExpression') {
		assert.equal(matchStatement.expression.arms[0]?.pattern.kind, 'ListPattern');
	}
	const updateStatement = body.statements[2];
	assert.equal(updateStatement?.kind, 'DiscardStatement');
	if (updateStatement?.kind === 'DiscardStatement') assert.equal(updateStatement.expression.kind, 'RecordUpdateExpression');
});

test('malformed contextual aggregate and index syntax fail as parser diagnostics without AST crashes', () => {
	for (const text of [
		'fn bad() {\n\tdiscard { value 1 }\n}\n',
		'fn bad(target: Unknown) {\n\tdiscard target[0\n}\n',
		'fn bad(target: Unknown) {\n\ttarget[0 = 1\n}\n',
	]) {
		let result: ReturnType<typeof compileSource> | undefined;
		assert.doesNotThrow(() => { result = compileSource(source(text), { emit: false }); });
		assert.ok(result);
		const codes = errorCodes(result);
		assert.ok(codes.includes('L0002'));
		assert.ok(!codes.includes('L9001'));
		assert.equal(result.ast, undefined);
	}
});

// @virune-rule {"id":"eval.contextual-source-forms","runner":"unit","file":"packages/compiler/test/contextual-source-forms.test.ts","case":"invalid assignment targets are semantic errors and never crash AST construction","kind":"negative","platform":"common"}
test('invalid assignment targets are semantic errors and never crash AST construction', () => {
	for (const text of [
		'fn bad() {\n\tmake() = 1\n}\n',
		'fn bad() {\n\ttrue = 1\n}\n',
		'fn bad() {\n\t(1 + 2) = 3\n}\n',
	]) {
		let result: ReturnType<typeof compileSource> | undefined;
		assert.doesNotThrow(() => { result = compileSource(source(text), { emit: false }); });
		assert.ok(result);
		assert.ok(errorCodes(result).includes('L2118'));
		assert.ok(!errorCodes(result).includes('L9001'), 'invalid assignment targets must not fail AST construction');
	}
});

// @virune-rule {"id":"eval.contextual-source-forms","runner":"unit","file":"packages/compiler/test/contextual-source-forms.test.ts","case":"postfix chains keep their syntactic evaluation order","kind":"positive","platform":"common"}
test('postfix chains keep their syntactic evaluation order', () => {
	const { body } = functionBody(`fn read(target: Unknown, key: String) {
	discard target.items[key].name
}
`);
	const statement = body.statements[0];
	assert.equal(statement?.kind, 'DiscardStatement');
	if (statement?.kind !== 'DiscardStatement') return;
	assert.equal(statement.expression.kind, 'FieldExpression');
	if (statement.expression.kind !== 'FieldExpression') return;
	assert.equal(statement.expression.field, 'name');
	assert.equal(statement.expression.target.kind, 'IndexExpression');
	if (statement.expression.target.kind !== 'IndexExpression') return;
	assert.equal(statement.expression.target.target.kind, 'FieldExpression');
});
