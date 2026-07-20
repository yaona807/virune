import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { compileSource } from '@virune/compiler/experimental';
import { TypeScriptInteropProvider } from '../src/index.js';

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

test('direct facade executes ESM and CommonJS default imports without losing primitive checks', async () => {
	const provider = new TypeScriptInteropProvider({ projectRoot: repositoryRoot });
	const outputRoot = join(repositoryRoot, '.test-tmp', 'interop-direct');
	await mkdir(outputRoot, { recursive: true });
	const sourcePath = join(outputRoot, 'main.virune');
	const result = compileSource({ id: 1, path: sourcePath, text: `import js { nanoid } from "nanoid"
import js axios from "axios"
import js lodash from "lodash"

@jsExport
pub fn smoke() -> String uses JavaScript {
	let id: String = nanoid(8)
	let axiosVersion: String = axios.VERSION
	let lodashVersion: String = lodash.VERSION
	return id + ":" + axiosVersion + ":" + lodashVersion
}
` }, { platform: 'node', jsInteropProvider: provider });
	assert.deepEqual(result.diagnostics.filter(item => item.severity === 'error'), []);
	const outputPath = join(outputRoot, 'main.js');
	await writeFile(outputPath, result.output?.code ?? '', 'utf8');
	const module = await import(`${pathToFileURL(outputPath).href}?v=${Date.now()}`) as { smoke(): string };
	assert.match(module.smoke(), /^[A-Za-z0-9_-]{8}:1\.18\.1:4\.18\.1$/u);
});
