import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildProject } from '../src/project/project.js';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const temporaryRoot = join(repositoryRoot, '.test-tmp');

// @virune-rule {"id":"ffi.unknown-provenance","runner":"unit","file":"packages/compiler/test/ffi-safe-descriptor-script-escape.test.ts","case":"record-valued Safe jsonDefault escapes script terminators from canonical type identity","kind":"positive","platform":"common"}
test('record-valued Safe jsonDefault escapes script terminators from canonical type identity', async () => {
	await mkdir(temporaryRoot, { recursive: true });
	const root = await mkdtemp(join(temporaryRoot, 'ffi-safe-descriptor-script-escape-'));
	try {
		const sourceRoot = join(root, 'src', '<', 'script>');
		await mkdir(sourceRoot, { recursive: true });
		await writeFile(join(root, 'virune.json'), JSON.stringify({
			languageVersion: '1.0',
			platform: 'node',
			sourceDir: 'src',
			outDir: 'dist',
			entry: 'src/</script>/main.virune',
			target: 'es2022',
			sourceMap: false,
			sourcesContent: false,
		}), 'utf8');
		await writeFile(join(sourceRoot, 'main.virune'), `extern js "./library.js" {
	fn accept(value: Payload) -> Result<Bool, JsError> = "accept"
}

record Nested derives Json {
	value: String
}

record Payload derives Json {
	@jsonDefault(Nested { value: "fallback" })
	nested: Nested
}

fn run(value: Payload) -> Result<Bool, JsError> uses JavaScript {
	return accept(value)
}
`, 'utf8');

		const result = await buildProject(root, { write: false });
		assert.deepEqual(result.diagnostics.filter(item => item.severity === 'error'), []);
		const module = result.modules.find(item => item.source.path.endsWith('main.virune'));
		assert.ok(module?.output);
		const code = module.output.code;
		assert.match(code, /defaultValue: makeRecord\(/u);
		assert.match(code, /\\u003C\\u002Fscript\\u003E/u);
		assert.doesNotMatch(code, /<\/script>/u);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
