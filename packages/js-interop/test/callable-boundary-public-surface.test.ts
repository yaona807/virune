import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { compileSource } from '@virune/compiler/experimental';
import { TypeScriptInteropProvider } from '../src/index.js';
import { fixtureRoot } from './fixture.js';

test('generated callable helper and cache remain module-private implementation details', async () => {
	const root = await fixtureRoot();
	await writeFile(join(root, 'src/library.d.ts'), 'export declare function consume(callback: (value: number) => number): void;\n', 'utf8');
	const provider = new TypeScriptInteropProvider({ projectRoot: root });
	const result = compileSource({
		id: 1,
		path: join(root, 'src/main.virune'),
		text: `import js { consume } from "./library.js"\n\nfn callback(value: Float) -> Float {\n\treturn value\n}\n\nfn main() -> Unit uses JavaScript {\n\tdiscard consume(callback)\n\treturn Unit\n}\n`,
	}, { platform: 'node', jsInteropProvider: provider });
	assert.deepEqual(result.diagnostics.filter(item => item.severity === 'error'), []);
	const code = result.output?.code ?? '';
	assert.match(code, /const \$viruneCallableShimCacheKey = '\$virune\.callable-shim\.cache\/v1'/u);
	assert.match(code, /const \$viruneCallableShimObject = \(\{\}\)\.constructor/u);
	assert.match(code, /function \$viruneProjectCallable\(/u);
	assert.doesNotMatch(code, /export\s+(?:const|function)\s+\$virune(?:CallableShimCacheKey|CallableShimObject|ProjectCallable)\b/u);
	assert.doesNotMatch(code, /export\s*\{[^}]*\$virune(?:CallableShimCacheKey|CallableShimObject|ProjectCallable)\b[^}]*\}/u);
});
