import assert from 'node:assert/strict';
import test from 'node:test';
import { formatSource } from '../src/index.js';

test('formatter is idempotent', () => {
	const source = 'fn add(left:Int,right:Int)->Int {\nreturn left+right\n}\n';
	const first = formatSource(source);
	const second = formatSource(first.text);
	assert.equal(first.errors.length, 0);
	assert.equal(second.text, first.text);
});

test('formatter supports newtypes, type aliases, strategy records, loop control, and discard', () => {
	const source = '@mustUse\nrecord Token{value:String,}\nnewtype TokenId=Int\ntype Display=fn(Token)->String\nrecord TokenDisplay{display:Display,}\nfn run(values:List<Int>,strategy:TokenDisplay)->Unit{for value in values{if value==0{continue\n}\nif value==1{break\n}\n}\ndiscard strategy.display(Token{value:"ok"})\ndiscard Ok<Int,String>(1)\nreturn Unit\n}\n';
	const first = formatSource(source);
	assert.equal(first.errors.length, 0);
	const second = formatSource(first.text);
	assert.equal(second.errors.length, 0);
	assert.equal(second.text, first.text);
	assert.match(first.text, /newtype TokenId = Int/u);
	assert.match(first.text, /type Display = fn\(Token\) -> String/u);
	assert.match(first.text, /record TokenDisplay/u);
	assert.match(first.text, /discard Ok<Int, String>\(1\)/u);
});

test('formatter preserves leading, trailing, dangling, and file-end comments', async () => {
	const { lex } = await import('@virune/compiler/experimental');
	const source = `record User {
	name: String
	// age field
	age: Int // years
}

fn add(left: Int, right: Int) -> Int {
	return left + right
}

fn run() -> Int {
	let values = [
		1,
		// second item
		2, // last item
	]
	let user = User {
		name: "Alice",
		// age value
		age: 30, // literal years
	}
	return add(
		values.length,
		// include age
		user.age, // final argument
	)
}
// file end
`;
	const first = formatSource(source);
	assert.deepEqual(first.errors, []);
	const second = formatSource(first.text);
	assert.deepEqual(second.errors, []);
	assert.equal(second.text, first.text);
	assert.deepEqual(
		lex(first.text).comments.map(comment => comment.image),
		lex(source).comments.map(comment => comment.image),
	);
	assert.ok(first.text.indexOf('// second item') < first.text.indexOf('2'));
	assert.ok(first.text.indexOf('// age value') < first.text.indexOf('age: 30'));
	assert.match(first.text, /2,? \/\/ last item/u);
	assert.match(first.text, /\/\/ file end\n$/u);
});

test('formatter preserves comment text while trimming trailing horizontal whitespace', async () => {
	const { lex } = await import('@virune/compiler/experimental');
	const source = 'fn run() -> Unit {\n\t// leading\t\n\tlet values = [\n\t\t1, // first\t\t\n\t\t// second \t\n\t\t2,\n\t]\n\treturn Unit\n}\n// file end\t\n';
	const result = formatSource(source);
	assert.deepEqual(result.errors, []);
	assert.doesNotMatch(result.text, /[ \t]+\n/u);
	assert.deepEqual(
		lex(result.text).comments.map(comment => comment.image),
		lex(source).comments.map(comment => comment.image.replace(/[ \t]+$/u, '')),
	);
	assert.equal(formatSource(result.text).text, result.text);
});

test('formatter comment restoration is stable across deterministic generated fixtures', async () => {
	const { lex } = await import('@virune/compiler/experimental');
	const iterations = Number.parseInt(process.env.VIRUNE_FUZZ_ITERATIONS ?? '100', 10);
	for (let index = 0; index < iterations; index++) {
		const source = `fn value${index}(left: Int, right: Int) -> Int {
	let values = [
		left,
		// generated ${index}
		right, // trailing ${index}
	]
	return values.length
}
`;
		const first = formatSource(source);
		const second = formatSource(first.text);
		assert.deepEqual(first.errors, [], `fixture ${index}`);
		assert.equal(second.text, first.text, `fixture ${index}`);
		assert.deepEqual(
			lex(first.text).comments.map(comment => comment.image),
			lex(source).comments.map(comment => comment.image),
			`fixture ${index}`,
		);
	}
});

test('formatter prints await Result propagation without redundant parentheses', () => {
	const source = 'async fn load() -> Result<Int, String> => Ok(1)\n\nasync fn run() -> Result<Int, String> {\n\tlet value = (await load())?\n\treturn Ok(value)\n}\n';
	const result = formatSource(source);
	assert.deepEqual(result.errors, []);
	assert.match(result.text, /let value = await load\(\)\?/u);
	assert.equal(formatSource(result.text).text, result.text);
});

test('formatter preserves JavaScript import forms', () => {
	const source = `import js defaultExport from "pkg-default"\nimport js * as namespace from "pkg-namespace"\nimport js { named as local } from "pkg-named"\nimport js "pkg-side-effect"\n\nfn run() -> Unit uses JavaScript {\n\tdiscard defaultExport\n\tdiscard namespace\n\tdiscard local\n\treturn Unit\n}\n`;
	const result = formatSource(source);
	assert.deepEqual(result.errors, []);
	assert.match(result.text, /import js defaultExport from "pkg-default"/u);
	assert.match(result.text, /import js \* as namespace from "pkg-namespace"/u);
	assert.match(result.text, /import js \{ named as local \} from "pkg-named"/u);
	assert.match(result.text, /import js "pkg-side-effect"/u);
});

test('formatter preserves tuple type annotations and tuple patterns', () => {
	const input = 'fn swap(pair:(String,Int))->(Int,String){\nreturn match pair{\n(name,age)=>(age,name)\n}\n}\n';
	const formatted = formatSource(input);
	assert.deepEqual(formatted.errors, []);
	assert.match(formatted.text, /pair: \(String, Int\)/u);
	assert.match(formatted.text, /\(name, age\) => \(age, name\)/u);
});

test('formatter normalizes and preserves documentation comment markers', async () => {
	const { lex } = await import('@virune/compiler/experimental');
	const source = `//!Module documentation
//!
//! Details
//!${'   '}

///Function documentation
///
/// Details
///${' '}
fn value() -> Int => 1

//// ordinary separator
`;
	const first = formatSource(source);
	assert.deepEqual(first.errors, []);
	assert.match(first.text, /^\/\/! Module documentation\n\/\/!\n\/\/! Details\n\/\/!$/mu);
	assert.match(first.text, /\/\/\/ Function documentation\n\/\/\/\n\/\/\/ Details\n\/\/\/$/mu);
	assert.match(first.text, /\/\/\/\/ ordinary separator/u);
	assert.equal(formatSource(first.text).text, first.text);
	assert.deepEqual(lex(first.text).comments.map(comment => comment.tokenType.name), [
		'ModuleDocumentationComment',
		'ModuleDocumentationComment',
		'ModuleDocumentationComment',
		'ModuleDocumentationComment',
		'DocumentationComment',
		'DocumentationComment',
		'DocumentationComment',
		'DocumentationComment',
		'LineComment',
	]);
});
