import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import { buildProject } from '@virune/compiler/experimental';
import { TypeScriptInteropProvider } from '../src/index.js';

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const temporaryRoot = join(repositoryRoot, '.test-tmp');

async function buildFixture() {
	await mkdir(temporaryRoot, { recursive: true });
	const root = await mkdtemp(join(temporaryRoot, 'virune-interop-unknown-provenance-'));
	await mkdir(join(root, 'src'), { recursive: true });
	await writeFile(join(root, 'virune.json'), JSON.stringify({
		languageVersion: '1.0',
		platform: 'node',
		sourceDir: 'src',
		outDir: 'dist',
		entry: 'src/main.virune',
		target: 'es2022',
		sourceMap: false,
		sourcesContent: false,
	}), 'utf8');
	await writeFile(join(root, 'src/main.virune'), `import js { foreignValue, sameForeign, acceptUnknown, acceptAny } from "./library.js"

extern js "./library.js" {
	fn acceptBoundary(value: Unknown) -> Result<Bool, JsError> = "acceptUnknown"
}

pub record Payload {
	value: String
}

fn callback(value: String) -> String {
	return value
}

async fn closeHandle(handle: FileHandle) -> Unit uses File {
	discard await File.close(handle)
	return Unit
}

@jsExport
pub fn roundTripForeign() -> Bool uses JavaScript {
	let value: Unknown = foreignValue()
	return sameForeign(value)
}

@jsExport
pub fn nativeString(value: String) -> Bool uses JavaScript {
	return acceptUnknown(value)
}

@jsExport
pub fn nativeBool(value: Bool) -> Bool uses JavaScript {
	return acceptUnknown(value)
}

@jsExport
pub fn nativeFloat(value: Float) -> Bool uses JavaScript {
	return acceptAny(value)
}

@jsExport
pub fn nativeBigInt(value: BigInt) -> Bool uses JavaScript {
	return acceptAny(value)
}

@jsExport
pub fn rejectRecord(value: Payload) -> Result<Bool, JsError> uses JavaScript {
	let erased: Unknown = value
	return acceptBoundary(erased)
}

@jsExport
pub fn rejectList(value: List<String>) -> Result<Bool, JsError> uses JavaScript {
	let erased: Unknown = value
	return acceptBoundary(erased)
}

@jsExport
pub fn rejectCallable() -> Result<Bool, JsError> uses JavaScript {
	let erased: Unknown = callback
	return acceptBoundary(erased)
}

@jsExport
pub async fn rejectFileHandle(path: String) -> Result<Bool, JsError> uses File, JavaScript {
	let handle = (await File.open(path, "r"))?
	defer await closeHandle(handle)
	let erased: Unknown = handle
	return acceptBoundary(erased)
}
`, 'utf8');
	await writeFile(join(root, 'src/library.d.ts'), `export declare function foreignValue(): unknown;
export declare function sameForeign(value: unknown): boolean;
export declare function acceptUnknown(value: unknown): boolean;
export declare function acceptAny(value: any): boolean;
`, 'utf8');
	const librarySource = `const foreign = { token: 1 };
let calls = 0;
export function foreignValue() { return foreign; }
export function sameForeign(value) { calls++; return value === foreign; }
export function acceptUnknown(_value) { calls++; return true; }
export function acceptAny(_value) { calls++; return true; }
export function callCount() { return calls; }
`;
	await writeFile(join(root, 'src/library.js'), librarySource, 'utf8');
	const provider = new TypeScriptInteropProvider({ projectRoot: root });
	const result = await buildProject(root, { write: true, jsInteropProvider: provider });
	assert.deepEqual(result.diagnostics.filter(item => item.severity === 'error'), []);
	await writeFile(join(root, 'dist/library.js'), librarySource, 'utf8');
	return root;
}

interface EncodedResult {
	readonly $tag: string;
	readonly $values: readonly unknown[];
}

function assertProvenanceRejection(result: EncodedResult): void {
	assert.equal(result.$tag, 'Err');
	const error = result.$values[0] as { readonly name?: unknown; readonly message?: unknown };
	assert.equal(error.name, 'ForeignContractError');
	assert.match(String(error.message), /foreign-origin Unknown or native primitive/u);
}

// @virune-rule {"id":"ffi.unknown-provenance","runner":"unit","file":"packages/js-interop/test/unknown-provenance-runtime.test.ts","case":"emitted Safe boundary preserves foreign identity and rejects erased native identity values","kind":"positive","platform":"node"}
test('emitted Safe boundary preserves foreign identity and rejects erased native identity values', async () => {
	const root = await buildFixture();
	const output = await readFile(join(root, 'dist/main.js'), 'utf8');
	assert.match(output, /version: 'virune-safe-ffi\/v1', type: \{ kind: 'unknown' \}/u);

	const module = await import(`${pathToFileURL(join(root, 'dist/main.js')).href}?case=unknown-provenance`) as {
		roundTripForeign(): boolean;
		nativeString(value: string): boolean;
		nativeBool(value: boolean): boolean;
		nativeFloat(value: number): boolean;
		nativeBigInt(value: bigint): boolean;
		rejectRecord(value: { value: string }): EncodedResult;
		rejectList(value: string[]): EncodedResult;
		rejectCallable(): EncodedResult;
		rejectFileHandle(path: string): Promise<EncodedResult>;
	};
	const library = await import(`${pathToFileURL(join(root, 'dist/library.js')).href}`) as { callCount(): number };

	assert.equal(module.roundTripForeign(), true);
	assert.equal(module.nativeString('safe'), true);
	assert.equal(module.nativeBool(true), true);
	assert.equal(module.nativeFloat(1.5), true);
	assert.equal(module.nativeBigInt(7n), true);
	assert.equal(library.callCount(), 5);

	assertProvenanceRejection(module.rejectRecord({ value: 'native' }));
	assertProvenanceRejection(module.rejectList(['native']));
	assertProvenanceRejection(module.rejectCallable());
	const resourcePath = join(root, 'resource.txt');
	await writeFile(resourcePath, 'resource', 'utf8');
	assertProvenanceRejection(await module.rejectFileHandle(resourcePath));
	assert.equal(library.callCount(), 5);
});
