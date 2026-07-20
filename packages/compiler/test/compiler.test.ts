import assert from 'node:assert/strict';
import test from 'node:test';
import { compileSource } from '../src/compiler.js';
import { evaluatePureFunction } from '../src/reference/evaluator.js';
import { lowerToHir } from '../src/hir/lower.js';
import { EffectRegistry } from '../src/checker/effect-registry.js';
import { TypeArena } from '../src/types/types.js';
import { compileSource as compilePublicSource } from '../src/public-api.js';

const source = (text: string) => ({ id: 1, path: 'test.virune', text });

test('typed HIR records resolved types, symbols, and MIR control flow', () => {
	const result = compileSource(source('fn classify(value: Int) -> String {\n\tif value > 0 {\n\t\treturn "positive"\n\t}\n\treturn "other"\n}\n'), { emit: false });
	assert.deepEqual(result.diagnostics.filter(item => item.severity === 'error'), []);
	const hir = lowerToHir(result.ast!, result.semantic!);
	assert.ok(hir.nodeTypes.size > 0);
	assert.ok(hir.symbolReferences.size > 0);
	assert.equal(hir.mirFunctions.length, 1);
	assert.ok(hir.mirFunctions[0]!.blocks.some(block => block.terminator.kind === 'branch'));
});

test('TypeArena interns composite types and preserves nominal identity', () => {
	const arena = new TypeArena();
	assert.equal(arena.list(arena.int), arena.list(arena.int));
	assert.equal(arena.result(arena.string, arena.int), arena.result(arena.string, arena.int));
	const first = arena.add({ kind: 'named', name: 'User', definitionId: 'a#User', declarationKind: 'record', arguments: [] });
	const second = arena.add({ kind: 'named', name: 'User', definitionId: 'b#User', declarationKind: 'record', arguments: [] });
	assert.equal(arena.equals(first, second), false);
});


test('invalid types and built-in effects remain compiler-internal domains', () => {
	const arena = new TypeArena();
	assert.equal(arena.display(arena.invalid), '<invalid>');
	assert.equal(arena.get(arena.invalid).kind, 'primitive');

	const effects = new EffectRegistry();
	effects.registerBuiltin('Console');
	assert.equal(effects.has('Console'), true);
	assert.equal(effects.get('Console')?.builtin, true);
	assert.equal(effects.has('Audit'), false);
});

test('parser diagnostics at end of file always use finite in-range positions', () => {
	const text = 'fn broken() -> List<Int> { return [';
	const result = compileSource(source(text), { emit: false });
	assert.ok(result.diagnostics.length > 0);
	for (const diagnostic of result.diagnostics) {
		assert.ok(Number.isFinite(diagnostic.span.start.offset));
		assert.ok(Number.isFinite(diagnostic.span.end.offset));
		assert.ok(diagnostic.span.start.offset >= 0);
		assert.ok(diagnostic.span.end.offset >= diagnostic.span.start.offset);
		assert.ok(diagnostic.span.end.offset <= text.length);
	}
});

test('compiler fuzz: parser and checker never throw for deterministic malformed input corpus', () => {
	let state = 0x5eed1234;
	const next = (): number => {
		state = (state * 1664525 + 1013904223) >>> 0;
		return state;
	};
	const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789{}[]()<>+-*/?:,\n\t "@';
	const iterations = Number.parseInt(process.env.VIRUNE_FUZZ_ITERATIONS ?? '1000', 10);
	for (let caseIndex = 0; caseIndex < iterations; caseIndex++) {
		const length = next() % 160;
		let text = '';
		for (let index = 0; index < length; index++) text += alphabet[next() % alphabet.length];
		assert.doesNotThrow(() => compileSource(source(text), { emit: false }), `fuzz case ${caseIndex}`);
	}
});


test('reference evaluator agrees with the pure language core', () => {
	const result = compileSource(source(`fn fibonacci(value: Int) -> Int {
	if value <= 1 {
		return value
	}
	return fibonacci(value - 1) + fibonacci(value - 2)
}
`), { emit: false });
	assert.deepEqual(result.diagnostics.filter(item => item.severity === 'error'), []);
	assert.equal(evaluatePureFunction(result.ast!, 'fibonacci', [10]), 55);
});

test('await followed by propagation binds as Try(Await(expression))', () => {
	const result = compileSource(source(`async fn load() -> Result<Int, String> => Ok(1)

async fn run() -> Result<Int, String> {
	let value = await load()?
	return Ok(value)
}
`), { emit: false });
	assert.deepEqual(result.diagnostics.filter(item => item.severity === 'error'), []);
	const run = result.ast?.declarations.find(item => item.kind === 'FunctionDeclaration' && item.name === 'run');
	assert.equal(run?.kind, 'FunctionDeclaration');
	if (run?.kind !== 'FunctionDeclaration' || run.body.kind !== 'BlockStatement') return;
	const statement = run.body.statements[0];
	assert.equal(statement?.kind, 'LetStatement');
	if (statement?.kind !== 'LetStatement') return;
	assert.equal(statement.value.kind, 'TryExpression');
	assert.equal(statement.value.kind === 'TryExpression' ? statement.value.operand.kind : undefined, 'AwaitExpression');
});

test('Unit functions may fall through without an explicit return', () => {
	const result = compileSource(source('fn remember(value: Int) -> Unit {\n\tlet remembered = value\n}\n'), { emit: false });
	assert.deepEqual(result.diagnostics.filter(item => item.severity === 'error'), []);
});

test('sync functions forward their task context to async calls', () => {
	const result = compileSource(source(`async fn load() -> Int {
	return 1
}

fn create() {
	return load()
}
`));
	assert.deepEqual(result.diagnostics.filter(item => item.severity === 'error'), []);
	assert.match(result.output?.code ?? '', /function create\(\$ctx = rootTaskContext\(\)\)/u);
	assert.match(result.output?.code ?? '', /load\(\$ctx\)/u);
});


test('stable compiler API omits AST and semantic internals', () => {
	const result = compilePublicSource(source('fn value() -> Int {\n\treturn 1\n}\n'));
	assert.deepEqual(result.diagnostics.filter(item => item.severity === 'error'), []);
	assert.equal('ast' in result, false);
	assert.equal('semantic' in result, false);
	assert.match(result.output?.code ?? '', /function value/u);
});

test('removed protocol keywords are rejected by the parser', () => {
	const result = compileSource(source('protocol Display {\n\tfn display(value: String) -> String\n}\n'), { emit: false });
	assert.ok(result.diagnostics.some(item => item.severity === 'error'));
});

test('strategy records provide explicit generic behaviour composition', () => {
	const result = compileSource(source(`record Encoder<T> {
	encode: fn(T) -> String
}

fn encodeValue<T>(value: T, encoder: Encoder<T>) -> String {
	return encoder.encode(value)
}
`), { emit: false });
	assert.deepEqual(result.diagnostics.filter(item => item.severity === 'error'), []);
});

test('generic record construction accepts explicit type arguments', () => {
	const result = compileSource(source(`record Encoder<T> {
	encode: fn(T) -> String
}

record User {
	name: String
}

fn encodeUser(user: User) -> String => user.name

fn createEncoder() -> Encoder<User> {
	return Encoder<User> { encode: encodeUser }
}
`), { emit: false });
	assert.deepEqual(result.diagnostics.filter(item => item.severity === 'error'), []);
});

test('explicit generic record construction participates in call inference', () => {
	const result = compileSource(source(`record Encoder<T> {
	encode: fn(T) -> String
}

record User {
	name: String
}

fn encodeUser(user: User) -> String => user.name

fn encode<T>(value: T, encoder: Encoder<T>) -> String {
	return encoder.encode(value)
}

fn main() -> String {
	return encode(User { name: "Virune" }, Encoder<User> { encode: encodeUser })
}
`), { emit: false });
	assert.deepEqual(result.diagnostics.filter(item => item.severity === 'error'), []);
});

test('explicit generic record construction remains checked against its expected type', () => {
	const result = compileSource(source(`record Encoder<T> {
	encode: fn(T) -> String
}

record User {
	name: String
}

fn encodeUser(user: User) -> String => user.name

fn createEncoder() -> Encoder<Int> {
	return Encoder<User> { encode: encodeUser }
}
`), { emit: false });
	assert.ok(result.diagnostics.some(item => item.code === 'L2043'));
});

test('records containing Float cannot derive structural Eq', () => {
	const result = compileSource(source(`record Measurement derives Eq {
	value: Float
}
`), { emit: false });
	assert.ok(result.diagnostics.some(item => item.code === 'L2061'));
});

test('tuple annotations and tuple patterns preserve element types', () => {
	const result = compileSource(source(`fn swap(pair: (String, Int)) -> (Int, String) {
	return match pair {
		(name, age) => (age, name)
	}
}
`), { emit: false });
	assert.deepEqual(result.diagnostics.filter(item => item.severity === 'error'), []);
	assert.deepEqual(evaluatePureFunction(result.ast!, 'swap', [['Alice', 26]]), [26, 'Alice']);
});

test('Validation is a transparent Result with a List error', () => {
	const result = compileSource(source(`fn normalize(value: Validation<Int, String>) -> Result<Int, List<String>> {
	return value
}
`), { emit: false });
	assert.deepEqual(result.diagnostics.filter(item => item.severity === 'error'), []);
});
