import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import { buildProject } from '@virune/compiler/experimental';
import { TypeScriptInteropProvider } from '../src/index.js';

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const temporaryRoot = join(repositoryRoot, '.test-tmp');

// @virune-rule {"id":"ffi.unknown-provenance","runner":"unit","file":"packages/js-interop/test/unknown-native-primitive-runtime.test.ts","case":"native primitives erased to Unknown cross TypeScript-proven unknown and any boundaries","kind":"positive","platform":"node"}
test('native primitives erased to Unknown cross TypeScript-proven unknown and any boundaries', async () => {
	await mkdir(temporaryRoot, { recursive: true });
	const root = await mkdtemp(join(temporaryRoot, 'virune-interop-unknown-native-primitives-'));
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
	await writeFile(join(root, 'src/main.virune'), `import js { acceptUnknown, acceptAny } from "./library.js"

@jsExport
pub fn stringValue(value: String) -> Bool uses JavaScript {
	let erased: Unknown = value
	return acceptUnknown(erased)
}

@jsExport
pub fn boolValue(value: Bool) -> Bool uses JavaScript {
	let erased: Unknown = value
	return acceptUnknown(erased)
}

@jsExport
pub fn floatValue(value: Float) -> Bool uses JavaScript {
	let erased: Unknown = value
	return acceptAny(erased)
}

@jsExport
pub fn bigIntValue(value: BigInt) -> Bool uses JavaScript {
	let erased: Unknown = value
	return acceptAny(erased)
}
`, 'utf8');
	await writeFile(join(root, 'src/library.d.ts'), 'export declare function acceptUnknown(value: unknown): boolean;\nexport declare function acceptAny(value: any): boolean;\n', 'utf8');
	const librarySource = 'export function acceptUnknown(_value) { return true; }\nexport function acceptAny(_value) { return true; }\n';
	await writeFile(join(root, 'src/library.js'), librarySource, 'utf8');
	const result = await buildProject(root, { write: true, jsInteropProvider: new TypeScriptInteropProvider({ projectRoot: root }) });
	assert.deepEqual(result.diagnostics.filter(item => item.severity === 'error'), []);
	await writeFile(join(root, 'dist/library.js'), librarySource, 'utf8');
	const module = await import(`${pathToFileURL(join(root, 'dist/main.js')).href}?case=unknown-native-primitives`) as {
		stringValue(value: string): boolean;
		boolValue(value: boolean): boolean;
		floatValue(value: number): boolean;
		bigIntValue(value: bigint): boolean;
	};
	assert.equal(module.stringValue('safe'), true);
	assert.equal(module.boolValue(true), true);
	assert.equal(module.floatValue(1.5), true);
	assert.equal(module.bigIntValue(7n), true);
});
