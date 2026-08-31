import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { compileSource } from '@virune/compiler/experimental';
import { TypeScriptInteropProvider } from '../src/index.js';
import { fixtureRoot } from './fixture.js';

// @virune-rule {"id":"ffi.unknown-provenance","runner":"unit","file":"packages/js-interop/test/unknown-whole-usage-negative.test.ts","case":"whole-usage TypeScript proof rejects Unknown for a specific string parameter","kind":"negative","platform":"node"}
test('whole-usage TypeScript proof rejects Unknown for a specific string parameter', async () => {
	const root = await fixtureRoot();
	await writeFile(join(root, 'src/library.d.ts'), 'export declare function acceptString(value: string): string;\n', 'utf8');
	await writeFile(join(root, 'src/library.js'), 'export function acceptString(value) { return value; }\n', 'utf8');
	const provider = new TypeScriptInteropProvider({ projectRoot: root });
	const result = compileSource({
		id: 1,
		path: join(root, 'src/unknown-to-string.virune'),
		text: `import js { acceptString } from "./library.js"\n\nfn use(value: Unknown) -> String uses JavaScript {\n\treturn acceptString(value)\n}\n`,
	}, { platform: 'node', jsInteropProvider: provider });
	assert.deepEqual(result.diagnostics.filter(item => item.severity === 'error').map(item => item.code), ['L4204']);
});
