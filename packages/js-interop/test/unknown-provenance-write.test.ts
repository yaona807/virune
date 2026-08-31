import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import { buildProject } from '@virune/compiler/experimental';
import { TypeScriptInteropProvider } from '../src/index.js';

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const temporaryRoot = join(repositoryRoot, '.test-tmp');

async function buildFixture(): Promise<string> {
	await mkdir(temporaryRoot, { recursive: true });
	const root = await mkdtemp(join(temporaryRoot, 'virune-interop-unknown-write-'));
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

	const librarySource = `
const foreign = { token: 1 };
let writes = 0;
export const state = new Proxy({ slot: null }, {
	set(target, key, value) {
		writes++;
		target[key] = value;
		return true;
	},
});
export function foreignValue() { return foreign; }
export function storedIsForeign() { return state.slot === foreign; }
export function writeCount() { return writes; }
`;
	await writeFile(join(root, 'src/library.js'), librarySource, 'utf8');
	await writeFile(join(root, 'src/library.d.ts'), `
export declare const state: { slot: unknown; [key: string]: unknown };
export declare function foreignValue(): unknown;
export declare function storedIsForeign(): boolean;
export declare function writeCount(): number;
`, 'utf8');
	await writeFile(join(root, 'src/main.virune'), `import js { state, foreignValue, storedIsForeign, writeCount } from "./library.js"

pub record Payload {
	value: String
}

@jsExport
pub fn foreignMemberWrite() -> Bool uses JavaScript {
	let value: Unknown = foreignValue()
	state.slot = value
	return storedIsForeign()
}

@jsExport
pub fn rejectMember(value: Payload) -> Float uses JavaScript {
	let erased: Unknown = value
	state.slot = erased
	return writeCount()
}

@jsExport
pub fn rejectIndex(value: Payload) -> Float uses JavaScript {
	let erased: Unknown = value
	state["extra"] = erased
	return writeCount()
}
`, 'utf8');

	const provider = new TypeScriptInteropProvider({ projectRoot: root });
	const result = await buildProject(root, { write: true, jsInteropProvider: provider });
	assert.deepEqual(result.diagnostics.filter(item => item.severity === 'error'), []);
	await writeFile(join(root, 'dist/library.js'), librarySource, 'utf8');
	return root;
}

// @virune-rule {"id":"ffi.unknown-provenance","runner":"unit","file":"packages/js-interop/test/unknown-provenance-write.test.ts","case":"Direct property and index writes preserve foreign Unknown and reject native identity before mutation","kind":"positive","platform":"node"}
test('Direct property and index writes preserve foreign Unknown and reject native identity before mutation', async () => {
	const root = await buildFixture();
	const module = await import(`${pathToFileURL(join(root, 'dist/main.js')).href}?case=unknown-write`) as {
		foreignMemberWrite(): boolean;
		rejectMember(value: { value: string }): number;
		rejectIndex(value: { value: string }): number;
	};
	const library = await import(`${pathToFileURL(join(root, 'dist/library.js')).href}`) as { writeCount(): number };

	assert.equal(module.foreignMemberWrite(), true);
	assert.equal(library.writeCount(), 1);

	assert.throws(
		() => module.rejectMember({ value: 'native-member' }),
		(error: unknown) => error instanceof Error && error.name === 'ForeignContractError',
	);
	assert.equal(library.writeCount(), 1);

	assert.throws(
		() => module.rejectIndex({ value: 'native-index' }),
		(error: unknown) => error instanceof Error && error.name === 'ForeignContractError',
	);
	assert.equal(library.writeCount(), 1);
});
