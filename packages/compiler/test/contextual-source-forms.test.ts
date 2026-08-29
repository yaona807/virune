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
