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

record Payload {
	value: String
}

fn callback(value: String) -> String {
	return value
}

@jsExport
pub fn roundTripForeign() -> Bool uses JavaScript {
	let value: Unknown = foreignValue()
	return sameForeign(value)
}

@jsExport
pub fn erasedString(value: String) -> Bool uses JavaScript {
	let erased: Unknown = value
	return acceptUnknown(erased)
}

@jsExport
pub fn erasedBool(value: Bool) -> Bool uses JavaScript {
	let erased: Unknown = value
	return acceptUnknown(erased)
}

@jsExport
pub fn erasedFloat(value: Float) -> Bool uses JavaScript {
	let erased: Unknown = value
	return acceptAny(erased)
}

@jsExport
pub fn erasedBigInt(value: BigInt) -> Bool uses JavaScript {
	let erased: Unknown = value
	return acceptAny(erased)
}

@jsExport
pub fn rejectRecord(value: Payload) -> Bool uses JavaScript {
	let erased: Unknown = value
	return acceptUnknown(erased)
}

@jsExport
pub fn rejectList(value: List<String>) -> Bool uses JavaScript {
	let erased: Unknown = value
	return acceptUnknown(erased)
}

@jsExport
pub fn rejectCallable() -> Bool uses JavaScript {
	let erased: Unknown = callback
	return acceptUnknown(erased)
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

function isProvenanceRejection(error: unknown): boolean {
	if (!(error instanceof TypeError)) return false;
	const contract = error as TypeError & { readonly expected?: unknown };
	return error.name === 'ForeignContractError' && contract.expected === 'foreign-origin Unknown or native primitive';
}

// @virune-rule {"id":"interop.unknown-provenance-runtime","runner":"integration","file":"packages/js-interop/test/unknown-provenance-runtime.test.ts","case":"emitted Safe boundary preserves foreign identity and rejects erased native identity values","kind":"positive","platform":"node"}
test('emitted Safe boundary preserves foreign identity and rejects erased native identity values', async () => {
	const root = await buildFixture();
	const output = await readFile(join(root, 'dist/main.js'), 'utf8');
	assert.match(output, /kind: 'unknown-provenance', version: 'v1'/u);

	const module = await import(`${pathToFileURL(join(root, 'dist/main.js')).href}?case=unknown-provenance`) as {
		roundTripForeign(): boolean;
		erasedString(value: string): boolean;
		erasedBool(value: boolean): boolean;
		erasedFloat(value: number): boolean;
		erasedBigInt(value: bigint): boolean;
		rejectRecord(value: { value: string }): boolean;
		rejectList(value: string[]): boolean;
		rejectCallable(): boolean;
	};
	const library = await import(`${pathToFileURL(join(root, 'dist/library.js')).href}`) as { callCount(): number };

	assert.equal(module.roundTripForeign(), true);
	assert.equal(module.erasedString('safe'), true);
	assert.equal(module.erasedBool(true), true);
	assert.equal(module.erasedFloat(1.5), true);
	assert.equal(module.erasedBigInt(7n), true);
	assert.equal(library.callCount(), 5);

	assert.throws(() => module.rejectRecord({ value: 'native' }), isProvenanceRejection);
	assert.throws(() => module.rejectList(['native']), isProvenanceRejection);
	assert.throws(() => module.rejectCallable(), isProvenanceRejection);
	assert.equal(library.callCount(), 5);
});
