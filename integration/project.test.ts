import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { originalPositionFor, TraceMap } from '@jridgewell/trace-mapping';
import { buildProject } from '@virune/compiler/experimental';
import { ResourceCleanupError } from '@virune/runtime';

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const temporaryRoot = join(repositoryRoot, '.test-tmp');

const config = (platform: 'node' | 'browser' | 'neutral' = 'node') => ({
	languageVersion: '1.0', platform, sourceDir: 'src', outDir: 'dist', entry: 'src/main.virune', target: 'es2022', sourceMap: true, sourcesContent: true,
});

async function project(files: Readonly<Record<string, string>>, platform: 'node' | 'browser' | 'neutral' = 'node'): Promise<string> {
	await mkdir(temporaryRoot, { recursive: true });
	const root = await mkdtemp(join(temporaryRoot, 'virune-'));
	await writeFile(join(root, 'virune.json'), JSON.stringify(config(platform)));
	for (const [name, text] of Object.entries(files)) {
		const path = join(root, 'src', name);
		await mkdir(dirname(path), { recursive: true });
		await writeFile(path, text);
	}
	return root;
}

function errors(result: Awaited<ReturnType<typeof buildProject>>): readonly string[] {
	return result.diagnostics.filter(item => item.severity === 'error').map(item => `${item.code}:${item.message}`);
}

test('buildProject emits an ES module and traceable source map', async () => {
	const root = await project({ 'main.virune': 'pub fn main() -> Unit uses Console {\n\tConsole.print("hello")\n\treturn Unit\n}\n' });
	const result = await buildProject(root, true);
	assert.deepEqual(errors(result), []);
	const js = await readFile(join(root, 'dist/main.js'), 'utf8');
	assert.match(js, /export function main/);
	const map = new TraceMap(await readFile(join(root, 'dist/main.js.map'), 'utf8'));
	const generatedLine = js.split('\n').findIndex(line => line.includes('console.log')) + 1;
	const original = originalPositionFor(map, { line: generatedLine, column: 2 });
	assert.equal(original.source?.endsWith('src/main.virune'), true);
	assert.equal(original.line, 2);
});

test('type-only imports are erased from JavaScript', async () => {
	const root = await project({
		'domain.virune': 'pub record User {\n\tname: String\n}\n',
		'main.virune': 'import type { User } from "./domain.virune"\n\npub fn name(user: User) -> String {\n\treturn user.name\n}\n',
	});
	const result = await buildProject(root, true);
	assert.deepEqual(errors(result), []);
	assert.doesNotMatch(await readFile(join(root, 'dist/main.js'), 'utf8'), /domain\.js/);
});

test('type-only newtype import cannot be used as a value', async () => {
	const root = await project({
		'domain.virune': 'pub newtype UserId = Int\n',
		'main.virune': 'import type { UserId } from "./domain.virune"\n\nfn create() -> UserId {\n\treturn UserId.create(1)\n}\n',
	});
	const result = await buildProject(root, false);
	assert.ok(errors(result).some(message => message.startsWith('L1012:')));
});

test('module cycles are rejected', async () => {
	const root = await project({
		'main.virune': 'import type { B } from "./b.virune"\n\npub record A {\n\tb: B\n}\n',
		'b.virune': 'import type { A } from "./main.virune"\n\npub record B {\n\ta: A\n}\n',
	});
	const result = await buildProject(root, false);
	assert.ok(errors(result).some(message => message.startsWith('L4002:')));
});

test('platform policy rejects Node.js externs in browser projects', async () => {
	const root = await project({ 'main.virune': 'extern js "node:crypto" {\n\tfn randomUuid() -> Result<String, JsError> = "randomUUID"\n}\n' }, 'browser');
	const result = await buildProject(root, false);
	assert.ok(errors(result).some(message => message.startsWith('L4006:')));
});

test('unsafe extern requires unsafe module under ffi directory', async () => {
	const valid = await project({
		'main.virune': 'import type { NativeValue } from "./ffi/native.virune"\n',
		'ffi/native.virune': 'unsafe module\n\nunsafe extern js "native" {\n\tfn load() -> NativeValue = "load"\n}\n\npub record NativeValue {\n\tvalue: String\n}\n',
	});
	assert.deepEqual(errors(await buildProject(valid, false)), []);

	const invalid = await project({ 'main.virune': 'unsafe module\n\nunsafe extern js "native" {\n\tfn load() -> String = "load"\n}\n' });
	const invalidErrors = errors(await buildProject(invalid, false));
	assert.ok(invalidErrors.some(message => message.startsWith('L4008:')));
	assert.ok(invalidErrors.some(message => message.startsWith('L4009:')));
});

test('safe Node.js FFI is callable from generated JavaScript', async () => {
	const root = await project({ 'main.virune': 'extern js "node:crypto" {\n\tfn randomUuid() -> Result<String, JsError> = "randomUUID"\n}\n\n@jsExport\npub fn createId() -> Result<String, JsError> {\n\treturn randomUuid()\n}\n' });
	const result = await buildProject(root, true);
	assert.deepEqual(errors(result), []);
	const module = await import(`${pathToFileURL(join(root, 'dist/main.js')).href}?test=${Date.now()}`) as { createId(): { $tag: string; $values: readonly unknown[] } };
	const value = module.createId();
	assert.equal(value.$tag, 'Ok');
	assert.match(String(value.$values[0]), /^[0-9a-f-]{36}$/u);
});

test('derived JSON decoder and encoder round-trip external data', async () => {
	const root = await project({ 'main.virune': 'pub record User derives Json {\n\tname: String\n\tnickname: String?\n}\n\n@jsExport\npub fn decodeUser(raw: Unknown) -> Result<User, List<JsonError>> {\n\treturn Json.decode<User>(raw)\n}\n\n@jsExport\npub fn encodeUser(user: User) -> Result<String, List<JsonError>> {\n\treturn Json.encode<User>(user)\n}\n' });
	const result = await buildProject(root, true);
	assert.deepEqual(errors(result), []);
	const module = await import(`${pathToFileURL(join(root, 'dist/main.js')).href}?test=${Date.now()}`) as {
		decodeUser(value: unknown): { $tag: string; $values: readonly unknown[] };
		encodeUser(value: unknown): { $tag: string; $values: readonly unknown[] };
	};
	const decoded = module.decodeUser({ name: 'Alice', nickname: null });
	assert.equal(decoded.$tag, 'Ok');
	const encoded = module.encodeUser({ name: 'Alice', nickname: 'Al' });
	assert.deepEqual(encoded, { $tag: 'Ok', $values: ['{"name":"Alice","nickname":"Al"}'] });
});

test('build output is deterministic', async () => {
	const root = await project({ 'main.virune': 'pub fn main() -> Unit uses Console {\n\tConsole.print("stable")\n\treturn Unit\n}\n' });
	assert.deepEqual(errors(await buildProject(root, true)), []);
	const first = await readFile(join(root, 'dist/main.js'), 'utf8');
	assert.deepEqual(errors(await buildProject(root, true)), []);
	const second = await readFile(join(root, 'dist/main.js'), 'utf8');
	assert.equal(first, second);
});

test('invalid configuration is reported as a diagnostic', async () => {
	await mkdir(temporaryRoot, { recursive: true });
	const root = await mkdtemp(join(temporaryRoot, 'virune-'));
	await writeFile(join(root, 'virune.json'), '{"languageVersion":"9"}');
	const result = await buildProject(root, false);
	assert.ok(errors(result).some(message => message.startsWith('L5002:')));
});

test('sourceMap false removes map output and sourceMappingURL', async () => {
	const root = await project({ 'main.virune': 'pub fn main() -> Unit {\n\treturn Unit\n}\n' });
	await writeFile(join(root, 'virune.json'), JSON.stringify({ ...config(), sourceMap: false }));
	const result = await buildProject(root, true);
	assert.deepEqual(errors(result), []);
	const js = await readFile(join(root, 'dist/main.js'), 'utf8');
	assert.doesNotMatch(js, /sourceMappingURL/u);
	await assert.rejects(readFile(join(root, 'dist/main.js.map'), 'utf8'));
});

test('public enums expose qualified variants across modules', async () => {
	const root = await project({
		'domain.virune': 'pub enum Status {\n\tPending\n\tFailed(String)\n}\n',
		'main.virune': 'import { Status } from "./domain.virune"\n\n@jsExport\npub fn createPending() -> Status {\n\treturn Status.Pending\n}\n\n@jsExport\npub fn createFailure() -> Status {\n\treturn Status.Failed("failure")\n}\n',
	});
	const result = await buildProject(root, true);
	assert.deepEqual(errors(result), []);
	const module = await import(`${pathToFileURL(join(root, 'dist/main.js')).href}?test=${Date.now()}`) as {
		createPending(): { $tag: string };
		createFailure(): { $tag: string; $values: readonly unknown[] };
	};
	assert.equal(module.createPending().$tag, 'Pending');
	assert.deepEqual(module.createFailure(), { $tag: 'Failed', $values: ['failure'] });
});


test('source maps use project-relative paths and omit absolute build paths', async () => {
	const root = await project({ 'main.virune': 'pub fn main() -> Unit {\n\treturn Unit\n}\n' });
	const result = await buildProject(root, true);
	assert.deepEqual(errors(result), []);
	const map = JSON.parse(await readFile(join(root, 'dist/main.js.map'), 'utf8')) as { file: string; sources: readonly string[] };
	assert.equal(map.file, 'main.js');
	assert.deepEqual(map.sources, ['src/main.virune']);
	assert.equal(JSON.stringify(map).includes(root), false);
});

test('JSON field names and defaults are honored by generated decoders and encoders', async () => {
	const root = await project({ 'main.virune': 'pub record User derives Json {\n\t@jsonName("user_name")\n\tname: String\n\t@jsonDefault("unknown")\n\tnickname: String\n}\n\n@jsExport\npub fn decodeUser(raw: Unknown) -> Result<User, List<JsonError>> {\n\treturn Json.decode<User>(raw)\n}\n\n@jsExport\npub fn encodeUser(user: User) -> Result<String, List<JsonError>> {\n\treturn Json.encode<User>(user)\n}\n' });
	const result = await buildProject(root, true);
	assert.deepEqual(errors(result), []);
	const module = await import(`${pathToFileURL(join(root, 'dist/main.js')).href}?test=${Date.now()}`) as {
		decodeUser(value: unknown): { $tag: string; $values: readonly unknown[] };
		encodeUser(value: unknown): { $tag: string; $values: readonly unknown[] };
	};
	const decoded = module.decodeUser({ user_name: 'Alice' });
	assert.equal(decoded.$tag, 'Ok');
	assert.deepEqual(decoded.$values[0], { name: 'Alice', nickname: 'unknown' });
	assert.deepEqual(module.encodeUser({ name: 'Alice', nickname: 'Al' }), { $tag: 'Ok', $values: ['{"user_name":"Alice","nickname":"Al"}'] });
});

test('defer executes in LIFO order on early return', async () => {
	const root = await project({ 'main.virune': 'fn add(value: String) -> Unit uses Console {\n\tConsole.print(value)\n\treturn Unit\n}\n\n@jsExport\npub fn run() -> Unit uses Console {\n\tdefer add("first")\n\tdefer add("second")\n\treturn Unit\n}\n' });
	const result = await buildProject(root, true);
	assert.deepEqual(errors(result), []);
	const module = await import(`${pathToFileURL(join(root, 'dist/main.js')).href}?test=${Date.now()}`) as { run(): void };
	const events: string[] = [];
	const original = console.log;
	console.log = value => { events.push(String(value)); };
	try { module.run(); } finally { console.log = original; }
	assert.deepEqual(events, ['second', 'first']);
});

test('Node standard library builtins compile, import selectively, and execute', async () => {
	const root = await project({ 'main.virune': '@jsExport\npub fn joinPath(parts: List<String>) -> String {\n\treturn Path.join(parts)\n}\n\n@jsExport\npub async fn read(path: String) -> Result<String, JsError> uses File {\n\treturn await File.readText(path)\n}\n' });
	const input = join(root, 'sample.txt');
	await writeFile(input, 'Virune');
	const result = await buildProject(root, true);
	assert.deepEqual(errors(result), []);
	const js = await readFile(join(root, 'dist/main.js'), 'utf8');
	assert.match(js, /@virune\/stdlib\/node\/path/u);
	assert.match(js, /@virune\/stdlib\/node\/fs/u);
	assert.doesNotMatch(js, /browser\/storage/u);
	const module = await import(`${pathToFileURL(join(root, 'dist/main.js')).href}?test=${Date.now()}`) as { joinPath(parts: readonly string[]): string; read(path: string): Promise<{ $tag: string; $values: readonly unknown[] }> };
	assert.equal(module.joinPath(['a', 'b']), join('a', 'b'));
	assert.deepEqual(await module.read(input), { $tag: 'Ok', $values: ['Virune'] });
});

test('platform-aware standard APIs are rejected outside their target', async () => {
	const browserUsingFile = await project({ 'main.virune': 'async fn read(path: String) -> Result<String, JsError> uses File {\n\treturn await File.readText(path)\n}\n' }, 'browser');
	assert.ok(errors(await buildProject(browserUsingFile, false)).some(message => message.startsWith('L4010:')));
	const nodeUsingStorage = await project({ 'main.virune': 'fn read(key: String) -> String? uses Storage {\n\treturn Storage.get(key)\n}\n' }, 'node');
	assert.ok(errors(await buildProject(nodeUsingStorage, false)).some(message => message.startsWith('L4011:')));
});

test('npm package subpaths use virune declarations for checking and JavaScript exports at runtime', async () => {
	const root = await project({
		'main.virune': 'import { double } from "example-package/tools"\n\n@jsExport\npub fn calculate(value: Int) -> Int {\n\treturn double(value)\n}\n',
	});
	const packageRoot = join(root, 'node_modules/example-package');
	await mkdir(join(packageRoot, 'src'), { recursive: true });
	await mkdir(join(packageRoot, 'dist'), { recursive: true });
	await writeFile(join(packageRoot, 'package.json'), JSON.stringify({
		name: 'example-package', type: 'module', exports: { './tools': { virune: './src/tools.virune', import: './dist/tools.js' } },
	}));
	await writeFile(join(packageRoot, 'src/tools.virune'), 'pub fn double(value: Int) -> Int {\n\treturn value * 2\n}\n');
	await writeFile(join(packageRoot, 'dist/tools.js'), 'export const double = value => value * 2;\n');
	const result = await buildProject(root, true);
	assert.deepEqual(errors(result), []);
	assert.equal(result.modules.find(module => module.source.path.endsWith('example-package/src/tools.virune'))?.outputPath, undefined);
	const js = await readFile(join(root, 'dist/main.js'), 'utf8');
	assert.match(js, /from "example-package\/tools"/u);
	const module = await import(`${pathToFileURL(join(root, 'dist/main.js')).href}?test=${Date.now()}`) as { calculate(value: number): number };
	assert.equal(module.calculate(4), 8);
});

test('File handles can be released with async defer', async () => {
	const root = await project({ 'main.virune': 'async fn close(handle: FileHandle) -> Unit uses File {\n\tlet result = await File.close(handle)\n\tmatch result {\n\t\tOk(_) => Unit\n\t\tErr(error) => panic(error.message)\n\t}\n\treturn Unit\n}\n\n@jsExport\npub async fn read(path: String) -> Result<String, JsError> uses File {\n\tlet handle = (await File.open(path, "r"))?\n\tdefer await close(handle)\n\treturn await File.read(handle)\n}\n' });
	const input = join(root, 'handle.txt');
	await writeFile(input, 'closed');
	const result = await buildProject(root, true);
	assert.deepEqual(errors(result), []);
	const module = await import(`${pathToFileURL(join(root, 'dist/main.js')).href}?test=${Date.now()}`) as { read(path: string): Promise<{ $tag: string; $values: readonly unknown[] }> };
	assert.deepEqual(await module.read(input), { $tag: 'Ok', $values: ['closed'] });
});

test('browser standard library builtins compile with browser-only imports', async () => {
	const root = await project({
		'main.virune': '@jsExport\npub fn elementText(selector: String) -> Result<String, JsError> uses Dom {\n\treturn Dom.getText(selector)\n}\n\n@jsExport\npub fn savedValue(key: String) -> String? uses Storage {\n\treturn Storage.get(key)\n}\n\nasync fn request(url: String) -> Result<HttpResponse, JsError> uses Network {\n\treturn await Fetch.get(url)\n}\n',
	}, 'browser');
	const result = await buildProject(root, true);
	assert.deepEqual(errors(result), []);
	const js = await readFile(join(root, 'dist/main.js'), 'utf8');
	assert.match(js, /@virune\/stdlib\/browser\/dom/u);
	assert.match(js, /@virune\/stdlib\/browser\/storage/u);
	assert.match(js, /@virune\/stdlib\/browser\/fetch/u);
	assert.doesNotMatch(js, /@virune\/stdlib\/node\/fs/u);
});

test('sync functions propagate the caller task context to futures they create', async () => {
	const root = await project({
		'main.virune': 'async fn load() -> Int {\n\treturn 1\n}\n\nfn create() {\n\treturn load()\n}\n',
	});
	const result = await buildProject(root, true);
	assert.deepEqual(errors(result), []);
	const js = await readFile(join(root, 'dist/main.js'), 'utf8');
	assert.match(js, /function create\(\$ctx = rootTaskContext\(\)\)/u);
	assert.match(js, /load\(\$ctx\)/u);
});

test('public function signatures retain transitive nominal types without explicit imports', async () => {
	const root = await project({
		'domain.virune': 'pub record User {\n\tname: String\n}\n\npub fn userName(user: User) -> String {\n\treturn user.name\n}\n',
		'main.virune': 'import { userName } from "./domain.virune"\n\nfn consume(user: Unknown) -> Unit {\n\treturn Unit\n}\n',
	});
	const result = await buildProject(root, false);
	assert.deepEqual(errors(result), []);
});

test('same-named records from different modules remain nominally distinct', async () => {
	const root = await project({
		'a.virune': 'pub record User {\n\tname: String\n}\n\npub fn createA() -> User {\n\treturn User { name: "A", }\n}\n',
		'b.virune': 'pub record User {\n\tname: String\n}\n\npub fn acceptB(user: User) -> String {\n\treturn user.name\n}\n',
		'main.virune': 'import { createA } from "./a.virune"\nimport { acceptB } from "./b.virune"\n\nfn invalid() -> String {\n\treturn acceptB(createA())\n}\n',
	});
	const result = await buildProject(root, false);
	assert.ok(errors(result).some(message => message.startsWith('L2043:')));
});

test('public API cannot expose a private nominal type', async () => {
	const root = await project({
		'main.virune': 'record Internal {\n\tvalue: String\n}\n\npub fn leak(value: Internal) -> String {\n\treturn value.value\n}\n',
	});
	const result = await buildProject(root, false);
	assert.ok(errors(result).some(message => message.startsWith('L4010:')));
});

test('const declarations are compile-time restricted and public constants are exported', async () => {
	const root = await project({
		'main.virune': 'pub const API_VERSION: String = "1.0"\nconst RETRIES: Int = 3\n\n@jsExport\npub fn version() -> String {\n\treturn API_VERSION\n}\n',
	});
	const result = await buildProject(root, true);
	assert.deepEqual(errors(result), []);
	const module = await import(`${pathToFileURL(join(root, 'dist/main.js')).href}?test=${Date.now()}`) as { API_VERSION: string; version(): string };
	assert.equal(module.API_VERSION, '1.0');
	assert.equal(module.version(), '1.0');
});

test('user capabilities are validated and flow through higher-order functions', async () => {
	const root = await project({
		'main.virune': 'fn auditLog(message: String) -> Unit uses Console {\n\tConsole.print(message)\n\treturn Unit\n}\n\nfn invoke(action: fn(String) -> Unit uses Console) -> Unit uses Console {\n\taction("event")\n\treturn Unit\n}\n\npub fn run() -> Unit uses Console {\n\tinvoke(auditLog)\n\treturn Unit\n}\n',
	});
	assert.deepEqual(errors(await buildProject(root, false)), []);
});

test('async block lambdas compile and execute', async () => {
	const root = await project({
		'main.virune': '@jsExport\npub async fn run() -> Result<Int, String> uses Task {\n\tlet action = async fn(value: Int) -> Result<Int, String> uses Task {\n\t\tlet next = value + 1\n\t\treturn Ok(next)\n\t}\n\treturn await action(1)\n}\n',
	});
	const result = await buildProject(root, true);
	assert.deepEqual(errors(result), []);
	const module = await import(`${pathToFileURL(join(root, 'dist/main.js')).href}?test=${Date.now()}`) as { run(): Promise<{ $tag: string; $values: readonly unknown[] }> };
	assert.deepEqual(await module.run(), { $tag: 'Ok', $values: [2] });
});

test('public imports re-export values and preserve original type identity', async () => {
	const root = await project({
		'domain.virune': 'pub record User {\n\tname: String\n}\n\npub fn createUser(name: String) -> User {\n\treturn User { name: name, }\n}\n',
		'facade.virune': 'pub import { User, createUser } from "./domain.virune"\n',
		'main.virune': 'import { User, createUser } from "./facade.virune"\n\n@jsExport\npub fn name() -> String {\n\tlet user: User = createUser("Virune")\n\treturn user.name\n}\n',
	});
	const result = await buildProject(root, true);
	assert.deepEqual(errors(result), []);
	const facade = await readFile(join(root, 'dist/facade.js'), 'utf8');
	assert.match(facade, /export \{ User, createUser \}/u);
	const module = await import(`${pathToFileURL(join(root, 'dist/main.js')).href}?test=${Date.now()}`) as { name(): string };
	assert.equal(module.name(), 'Virune');
});


test('generated defer aggregates the primary panic and every cleanup panic', async () => {
	const root = await project({
		'main.virune': '@jsExport\npub fn fail() -> Unit {\n\tdefer panic("first cleanup")\n\tdefer panic("second cleanup")\n\tpanic("primary")\n}\n',
	});
	const result = await buildProject(root, true);
	assert.deepEqual(errors(result), []);
	const module = await import(`${pathToFileURL(join(root, 'dist/main.js')).href}?test=${Date.now()}`) as { fail(): void };
	assert.throws(
		() => module.fail(),
		(error: unknown) => error instanceof ResourceCleanupError
			&& String(error.primary).includes('primary')
			&& error.cleanupErrors.length === 2
			&& String(error.cleanupErrors[0]).includes('second cleanup')
			&& String(error.cleanupErrors[1]).includes('first cleanup'),
	);
});

test('strategy records and structural collections compose in generated JavaScript', async () => {
	const root = await project({
		'main.virune': 'record Key derives Eq, Hash {\n\tvalue: String,\n}\n\nrecord Display<T> {\n\tdisplay: fn(T) -> String,\n}\n\nfn displayKey(value: Key) -> String {\n\treturn value.value\n}\n\n@jsExport\npub fn inspect() -> String {\n\tlet key = Key { value: "a", }\n\tlet same = Key { value: "a", }\n\tlet values = Set.from([key])\n\tlet display = Display<Key> { display: displayKey, }\n\tif Set.has(values, same) {\n\t\treturn display.display(same)\n\t}\n\treturn "missing"\n}\n',
	});
	const result = await buildProject(root, true);
	assert.deepEqual(errors(result), []);
	const module = await import(`${pathToFileURL(join(root, 'dist/main.js')).href}?test=${Date.now()}`) as { inspect(): string };
	assert.equal(module.inspect(), 'a');
});

test('must-use values require handling or explicit discard', async () => {
	const invalid = await project({
		'main.virune': 'fn load() -> Result<Int, String> {\n\treturn Ok(1)\n}\n\nfn main() -> Unit {\n\tload()\n\treturn Unit\n}\n',
	});
	assert.ok(errors(await buildProject(invalid, false)).some(message => message.startsWith('L2097:')));
	const valid = await project({
		'main.virune': 'fn load() -> Result<Int, String> {\n\treturn Ok(1)\n}\n\nfn main() -> Unit {\n\tdiscard load()\n\treturn Unit\n}\n',
	});
	assert.deepEqual(errors(await buildProject(valid, false)), []);
});

test('break and continue lower correctly through generated loops', async () => {
	const root = await project({
		'main.virune': '@jsExport\npub fn count(values: List<Int>) -> Int {\n\tlet mut total = 0\n\tfor value in values {\n\t\tif 0 > value {\n\t\t\tcontinue\n\t\t}\n\t\ttotal = total + value\n\t\tif total >= 3 {\n\t\t\tbreak\n\t\t}\n\t}\n\treturn total\n}\n',
	});
	const result = await buildProject(root, true);
	assert.deepEqual(errors(result), []);
	const module = await import(`${pathToFileURL(join(root, 'dist/main.js')).href}?test=${Date.now()}`) as { count(values: readonly number[]): number };
	assert.equal(module.count([-1, 1, 2, 100]), 3);
});

test('binary file APIs round-trip Bytes through paths and handles', async () => {
	const root = await project({
		'main.virune': 'async fn close(handle: FileHandle) -> Unit uses File {\n\tlet result = await File.close(handle)\n\tmatch result {\n\t\tOk(_) => Unit\n\t\tErr(error) => panic(error.message)\n\t}\n\treturn Unit\n}\n\n@jsExport\npub async fn roundTrip(path: String) -> Result<String, JsError> uses File {\n\tlet bytes = Bytes.fromUtf8("Virune")\n\tlet written = (await File.writeBytes(path, bytes))?\n\tlet handle = (await File.open(path, "r"))?\n\tdefer await close(handle)\n\tlet loaded = (await File.readHandleBytes(handle))?\n\treturn Ok(Bytes.toHex(loaded))\n}\n',
	});
	const output = join(root, 'binary.dat');
	const result = await buildProject(root, true);
	assert.deepEqual(errors(result), []);
	const module = await import(`${pathToFileURL(join(root, 'dist/main.js')).href}?test=${Date.now()}`) as { roundTrip(path: string): Promise<{ $tag: string; $values: readonly unknown[] }> };
	assert.deepEqual(await module.roundTrip(output), { $tag: 'Ok', $values: ['566972756e65'] });
});
