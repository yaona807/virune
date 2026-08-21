import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { IncrementalProjectBuilder } from '../src/interop/checked-api.js';
import { externalOperationSequence } from '../src/interop/operation-api.js';
import type { ProjectHost } from '../src/project/project.js';

const sourceText = 'fn main() -> Unit {}\n';

function hostFor(mainPath: string): ProjectHost {
	return {
		async readFile(path) {
			if (path === mainPath) return sourceText;
			throw Object.assign(new Error(`missing ${path}`), { code: 'ENOENT' });
		},
	};
}

test('IncrementalProjectBuilder invalidate and clear retire registered operation evidence immediately', async () => {
	const root = resolve('virtual-operation-session-invalidation-project');
	const mainPath = join(root, 'src/main.virune');
	const builder = new IncrementalProjectBuilder();
	const host = hostFor(mainPath);

	const first = await builder.build(root, { write: false, host });
	const firstMain = first.modules.find(module => module.source.path === mainPath);
	assert.ok(firstMain?.ast);
	assert.ok(firstMain.semantic);
	assert.deepEqual(first.diagnostics.filter(item => item.severity === 'error'), []);
	assert.deepEqual(externalOperationSequence({ module: firstMain.ast, semantic: firstMain.semantic }), []);

	builder.invalidate(mainPath);
	assert.throws(
		() => externalOperationSequence({ module: firstMain.ast!, semantic: firstMain.semantic! }),
		/not from the current checked AST semantic session/u,
	);

	const second = await builder.build(root, { write: false, host });
	const secondMain = second.modules.find(module => module.source.path === mainPath);
	assert.ok(secondMain?.ast);
	assert.ok(secondMain.semantic);
	assert.deepEqual(second.diagnostics.filter(item => item.severity === 'error'), []);
	assert.deepEqual(externalOperationSequence({ module: secondMain.ast, semantic: secondMain.semantic }), []);

	builder.clear();
	assert.throws(
		() => externalOperationSequence({ module: secondMain.ast!, semantic: secondMain.semantic! }),
		/not from the current checked AST semantic session/u,
	);
});
