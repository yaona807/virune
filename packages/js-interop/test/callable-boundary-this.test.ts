import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { compileSource } from '@virune/compiler/experimental';
import { TypeScriptInteropProvider } from '../src/index.js';
import { fixtureRoot } from './fixture.js';

test('callback target with an explicit this parameter remains adapter territory', async () => {
	const root = await fixtureRoot();
	await writeFile(
		join(root, 'src/library.d.ts'),
		'interface Context { readonly scale: number }\nexport declare function consume(callback: (this: Context, value: number) => number): void;\n',
		'utf8',
	);
	const provider = new TypeScriptInteropProvider({ projectRoot: root });
	const result = compileSource({
		id: 1,
		path: join(root, 'src/main.virune'),
		text: `import js { consume } from "./library.js"\n\nfn callback(value: Float) -> Float {\n\treturn value\n}\n\nfn main() -> Unit uses JavaScript {\n\tdiscard consume(callback)\n\treturn Unit\n}\n`,
	}, { platform: 'node', jsInteropProvider: provider });
	assert.ok(result.diagnostics.some(item => item.code === 'L4204'));
	assert.equal(result.semantic?.interop.callableProjections?.length ?? 0, 0);
});
