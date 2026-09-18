import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import test from 'node:test';
import type { JsInteropProvider } from '../src/interop/types.js';
import { buildProject, ProjectBuildCache } from '../src/project/project.js';

const config = JSON.stringify({
	languageVersion: '1.0',
	platform: 'browser',
	sourceDir: 'src',
	outDir: 'dist',
	entry: 'src/main.virune',
	target: 'es2022',
	sourceMap: true,
	sourcesContent: true,
});

const jsxValidationProvider: JsInteropProvider = {
	id: 'view-repetition-host-lowering-test',
	version: '1',
	generation: 1,
	resolveImport: () => { throw new Error('unexpected JavaScript import'); },
	getProperty: () => undefined,
	resolveCall: () => undefined,
	resolveConstruct: () => undefined,
	getAwaitedType: () => undefined,
	display: () => '<unused>',
	resolveJsxUsage: () => ({ accepted: true }),
};

const externalArrayProvider: JsInteropProvider = {
	...jsxValidationProvider,
	id: 'view-repetition-host-lowering-array-test',
	resolveImport(request) {
		return {
			type: {
				ref: { providerId: 'view-repetition-host-lowering-array-test', generation: 1, id: 'values-array' },
				display: 'ReadonlyArray<number>',
				category: 'array',
				origin: { moduleSpecifier: request.moduleSpecifier, exportName: request.importedName ?? 'values' },
			},
			runtime: { kind: 'named', importedName: request.importedName ?? 'values' },
			witness: {
				moduleSpecifier: request.moduleSpecifier,
				runtimeEntry: 'dist/library.js',
				runtimeFormat: 'esm',
				conditions: ['import', 'browser'],
				platform: request.platform,
				providerVersion: 'view-repetition-host-lowering-array-test-1',
			},
		};
	},
	resolveArrayElement: () => ({
		ref: { providerId: 'view-repetition-host-lowering-array-test', generation: 1, id: 'values-element' },
		display: 'number',
		category: 'primitive',
		primitive: 'number',
	}),
};

async function withProject(run: (root: string) => Promise<void>): Promise<void> {
	await mkdir(resolve('.cache'), { recursive: true });
	const root = await mkdtemp(join(resolve('.cache'), 'view-repetition-host-lowering-'));
	try {
		await mkdir(join(root, 'src'), { recursive: true });
		await writeFile(join(root, 'virune.json'), config, 'utf8');
		await run(root);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

function errors(result: Awaited<ReturnType<typeof buildProject>>) {
	return result.diagnostics.filter(item => item.severity === 'error');
}

function moduleOutput(result: Awaited<ReturnType<typeof buildProject>>, root: string, path = 'src/main.virune'): string | undefined {
	return result.modules.find(module => module.source.path === resolve(root, path))?.output?.code;
}

test('structural View repetition remains on the existing path without a Host locator', async () => {
	await withProject(async root => {
		await writeFile(join(root, 'src/main.virune'), `component Page() uses JavaScript {
	return view {
		for item in [1, 2] {
			span() { { item } }
		}
	}
}
`, 'utf8');
		const result = await buildProject(root, { write: false, jsInteropProvider: jsxValidationProvider });
		assert.deepEqual(errors(result), []);
		const code = moduleOutput(result, root);
		assert.ok(code);
		assert.ok(!code.includes('$viruneRepetitionHostModule'));
		assert.match(code, /for \(let \$viewIndex\d+ = 0;/u);
	});
});

test('identity-bearing View repetition fails closed without a project Host locator', async () => {
	await withProject(async root => {
		await writeFile(join(root, 'src/main.virune'), `component Page() uses JavaScript {
	return view {
		for item in [1, 2] by item {
			span() { { item } }
		}
	}
}
`, 'utf8');
		const result = await buildProject(root, { write: false, jsInteropProvider: jsxValidationProvider });
		assert.ok(errors(result).some(item => item.code === 'L2135' && item.message.includes('requires exactly one project @repetitionHost locator')));
		assert.equal(moduleOutput(result, root), undefined);
	});
});

test('ambiguous project Host locators keep identity repetition fail closed', async () => {
	await withProject(async root => {
		await writeFile(join(root, 'src/first.virune'), '@repetitionHost("first", 1)\nextern js "./first-host.js" {}\n', 'utf8');
		await writeFile(join(root, 'src/second.virune'), '@repetitionHost("second", 1)\nextern js "./second-host.js" {}\n', 'utf8');
		await writeFile(join(root, 'src/main.virune'), `import "./first.virune"
import "./second.virune"

component Page() uses JavaScript {
	return view {
		for item in [1, 2] by item {
			span() { { item } }
		}
	}
}
`, 'utf8');
		const result = await buildProject(root, { write: false, jsInteropProvider: jsxValidationProvider });
		assert.equal(errors(result).filter(item => item.code === 'L2134').length, 2);
		assert.ok(errors(result).some(item => item.code === 'L2135' && item.message.includes('ambiguous')));
		assert.equal(moduleOutput(result, root), undefined);
	});
});

test('identity repetition emits the uniform Host protocol with rebased locator provenance and current value reads', async () => {
	await withProject(async root => {
		await mkdir(join(root, 'src/infra'), { recursive: true });
		await writeFile(join(root, 'src/infra/locator.virune'), '@repetitionHost("render", 1)\nextern js "./repetition-host.js" {}\n', 'utf8');
		await writeFile(join(root, 'src/main.virune'), `import "./infra/locator.virune"

component Page() uses JavaScript {
	return view {
		for item, index in [1, 2] by item {
			span() { { item } }
			span() { { index } }
		}
		for label in ["a", "b"] by label {
			span() { { label } }
		}
	}
}
`, 'utf8');
		const result = await buildProject(root, { write: false, jsInteropProvider: jsxValidationProvider });
		assert.deepEqual(errors(result), []);
		const code = moduleOutput(result, root);
		assert.ok(code);
		assert.ok(code.includes('import * as $viruneRepetitionHostModule from "./infra/repetition-host.js";'));
		assert.ok(code.includes('$viruneRepetitionHostModule["render"]('));
		assert.match(code, /const \$viewSnapshotCtx\d+ = rootTaskContext\(\);/u);
		assert.match(code, /const \$viewBodyCtx\d+ = rootTaskContext\(\);/u);
		assert.match(code, /"i:" \+ \(item\)/u);
		assert.match(code, /"s:" \+ \(label\)/u);
		assert.match(code, /\.push\(\{ id: \$viewIdentity\d+, index: \$viewIndex\d+, value: item \}\);/u);
		const duplicateGuard = code.indexOf('.has($viewIdentity');
		const snapshotPush = code.indexOf('.push({ id: $viewIdentity');
		assert.ok(duplicateGuard >= 0);
		assert.ok(snapshotPush > duplicateGuard);
		assert.match(code, /\$viewReadValue\d+\(\)/u);
		assert.match(code, /\$viewReadIndex\d+\(\)/u);
		assert.match(code, /return <>/u);
	});
});

test('Host snapshot preserves sparse External Array source-index traversal', async () => {
	await withProject(async root => {
		await writeFile(join(root, 'src/locator.virune'), '@repetitionHost("render", 1)\nextern js "./repetition-host.js" {}\n', 'utf8');
		await writeFile(join(root, 'src/main.virune'), `import "./locator.virune"
import js { values } from "./library.js"

component Page() uses JavaScript {
	return view {
		for value, index in values by index {
			"body"
		}
	}
}
`, 'utf8');
		const result = await buildProject(root, { write: false, jsInteropProvider: externalArrayProvider });
		assert.deepEqual(errors(result), []);
		const code = moduleOutput(result, root);
		assert.ok(code);
		assert.match(code, /if \(!Object\.prototype\.hasOwnProperty\.call\(\$viewSource\d+, \$viewIndex\d+\)\) continue;/u);
		assert.match(code, /const value = \$viewSource\d+\[\$viewIndex\d+\];/u);
		assert.match(code, /\.push\(\{ id: \$viewIdentity\d+, index: \$viewIndex\d+, value: value \}\);/u);
	});
});

test('nested identity repetition composes through the same Host and reads the outer current value lazily', async () => {
	await withProject(async root => {
		await writeFile(join(root, 'src/locator.virune'), '@repetitionHost("render", 1)\nextern js "./repetition-host.js" {}\n', 'utf8');
		await writeFile(join(root, 'src/main.virune'), `import "./locator.virune"

component Page() uses JavaScript {
	return view {
		for outer, outerIndex in [[1, 2]] by outerIndex {
			for inner in outer by inner {
				span() { { inner } }
			}
		}
	}
}
`, 'utf8');
		const result = await buildProject(root, { write: false, jsInteropProvider: jsxValidationProvider });
		assert.deepEqual(errors(result), []);
		const code = moduleOutput(result, root);
		assert.ok(code);
		assert.equal((code.match(/\$viruneRepetitionHostModule\["render"\]\(/gu) ?? []).length, 2);
		assert.match(code, /const \$viewSource\d+ = \$viewReadValue\d+\(\);/u);
	});
});

test('changing only Host locator evidence invalidates cached identity repetition emission', async () => {
	await withProject(async root => {
		const locator = join(root, 'src/locator.virune');
		await writeFile(locator, '@repetitionHost("renderFirst", 1)\nextern js "./repetition-host.js" {}\n', 'utf8');
		await writeFile(join(root, 'src/main.virune'), `import "./locator.virune"

component Page() uses JavaScript {
	return view {
		for item in [1, 2] by item {
			span() { { item } }
		}
	}
}
`, 'utf8');
		const cache = new ProjectBuildCache();
		const first = await buildProject(root, { write: false, incrementalCache: cache, jsInteropProvider: jsxValidationProvider });
		assert.deepEqual(errors(first), []);
		const firstCode = moduleOutput(first, root);
		assert.ok(firstCode?.includes('$viruneRepetitionHostModule["renderFirst"]('));

		await writeFile(locator, '@repetitionHost("renderSecond", 1)\nextern js "./repetition-host.js" {}\n', 'utf8');
		const second = await buildProject(root, { write: false, incrementalCache: cache, jsInteropProvider: jsxValidationProvider });
		assert.deepEqual(errors(second), []);
		const secondCode = moduleOutput(second, root);
		assert.ok(secondCode?.includes('$viruneRepetitionHostModule["renderSecond"]('));
		assert.ok(!secondCode?.includes('["renderFirst"]('));
	});
});
