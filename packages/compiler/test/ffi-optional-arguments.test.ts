import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildProject } from '../src/project/project.js';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const temporaryRoot = join(repositoryRoot, '.test-tmp');

// @virune-rule {"id":"ffi.optional-arguments","runner":"unit","file":"packages/compiler/test/ffi-optional-arguments.test.ts","case":"optional extern arguments omit only the trailing undefined suffix","kind":"positive","platform":"node"}
test('optional extern arguments omit only the trailing undefined suffix', async () => {
	await mkdir(temporaryRoot, { recursive: true });
	const root = await mkdtemp(join(temporaryRoot, 'ffi-optional-'));
	try {
		await mkdir(join(root, 'src'), { recursive: true });
		const packageRoot = join(root, 'node_modules/ffi-optional-probe');
		await mkdir(packageRoot, { recursive: true });
		await writeFile(join(root, 'virune.json'), JSON.stringify({
			languageVersion: '1.0',
			platform: 'node',
			sourceDir: 'src',
			outDir: 'dist',
			entry: 'src/main.virune',
			target: 'es2022',
			sourceMap: true,
			sourcesContent: true,
		}));
		await writeFile(join(root, 'src/main.virune'), `extern js "ffi-optional-probe" {
	fn argumentCount(first?: String?, second?: String?) -> Result<Int, JsError> = "argumentCount"
	fn acceptUnknown(value?: Unknown) -> Result<Bool, JsError> = "acceptUnknown"
}

pub record Payload {
	value: String
}

@jsExport
pub fn omittedTrailingArgumentCount() -> Result<Int, JsError> {
	return argumentCount(None, None)
}

@jsExport
pub fn preservedHoleArgumentCount() -> Result<Int, JsError> {
	return argumentCount(None, Some("x"))
}

@jsExport
pub fn rejectedOptionalUnknown(value: Payload) -> Result<Bool, JsError> {
	let erased: Unknown = value
	return acceptUnknown(erased)
}
`);
		await writeFile(join(packageRoot, 'package.json'), JSON.stringify({
			name: 'ffi-optional-probe',
			type: 'module',
			exports: './index.js',
		}));
		await writeFile(join(packageRoot, 'index.js'), 'export function argumentCount() { return arguments.length; }\nexport function acceptUnknown(_value) { return true; }\n');

		const result = await buildProject(root, true);
		assert.deepEqual(result.diagnostics.filter(item => item.severity === 'error'), []);
		const module = await import(`${pathToFileURL(join(root, 'dist/main.js')).href}?test=${Date.now()}`) as {
			omittedTrailingArgumentCount(): { readonly $tag: string; readonly $values: readonly unknown[] };
			preservedHoleArgumentCount(): { readonly $tag: string; readonly $values: readonly unknown[] };
			rejectedOptionalUnknown(value: { readonly value: string }): { readonly $tag: string; readonly $values: readonly unknown[] };
		};
		assert.deepEqual(module.omittedTrailingArgumentCount(), { $tag: 'Ok', $values: [0] });
		assert.deepEqual(module.preservedHoleArgumentCount(), { $tag: 'Ok', $values: [2] });
		const rejected = module.rejectedOptionalUnknown({ value: 'native' });
		assert.equal(rejected.$tag, 'Err');
		assert.equal((rejected.$values[0] as { readonly name?: unknown }).name, 'ForeignContractError');
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
