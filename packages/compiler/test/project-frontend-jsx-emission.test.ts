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
	id: 'project-frontend-emission-test',
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

async function withProject(run: (root: string) => Promise<void>): Promise<void> {
	await mkdir(resolve('.cache'), { recursive: true });
	const root = await mkdtemp(join(resolve('.cache'), 'project-frontend-emission-'));
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

test('standalone project component emits JSX while ordinary Virune dependencies stay JavaScript', async () => {
	await withProject(async root => {
		await writeFile(join(root, 'src/helper.virune'), 'internal fn label() -> String => "ok"\n', 'utf8');
		await writeFile(join(root, 'src/main.virune'), `import { label } from "./helper.virune"

component Page(title: String) uses JavaScript {
	return view {
		div(title: title) {
			"hello"
		}
	}
}
`, 'utf8');
		const result = await buildProject(root, { write: false, jsInteropProvider: jsxValidationProvider });
		assert.deepEqual(errors(result), []);
		const main = result.modules.find(module => module.source.path === resolve(root, 'src/main.virune'));
		const helper = result.modules.find(module => module.source.path === resolve(root, 'src/helper.virune'));
		assert.equal(main?.outputPath, resolve(root, 'dist/main.jsx'));
		assert.equal(helper?.outputPath, resolve(root, 'dist/helper.js'));
		assert.ok(main?.output);
		assert.ok(main.output.code.includes('from "./helper.js";'));
		assert.ok(main.output.code.includes('<div title={'));
		assert.ok(main.output.code.endsWith('//# sourceMappingURL=main.jsx.map\n'));
		assert.equal(JSON.parse(main.output.map).file, 'main.jsx');
	});
});

test('project component emission reuses the existing host-prop boundary', async () => {
	await withProject(async root => {
		await writeFile(join(root, 'src/main.virune'), `record Config {
	label: String
}

component Page(config: Config) uses JavaScript {
	return view {
		div()
	}
}
`, 'utf8');
		const result = await buildProject(root, { write: false, jsInteropProvider: jsxValidationProvider });
		assert.ok(errors(result).some(item => item.code === 'L4309' && /frontend JSX emission currently supports only/u.test(item.message)));
		const main = result.modules.find(module => module.source.path === resolve(root, 'src/main.virune'));
		assert.equal(main?.output, undefined);
	});
});

test('incremental cache follows incoming Virune import changes in both directions', async () => {
	await withProject(async root => {
		await writeFile(join(root, 'src/main.virune'), `internal component Page() uses JavaScript {
	return view {
		div()
	}
}
`, 'utf8');
		const cache = new ProjectBuildCache();
		const first = await buildProject(root, { write: false, incrementalCache: cache, jsInteropProvider: jsxValidationProvider });
		assert.deepEqual(errors(first), []);
		assert.equal(first.modules.find(module => module.source.path === resolve(root, 'src/main.virune'))?.outputPath, resolve(root, 'dist/main.jsx'));

		const consumer = join(root, 'src/consumer.virune');
		await writeFile(consumer, `import { Page } from "./main.virune"

pub fn usePage() -> Unit {
	return Unit
}
`, 'utf8');
		const second = await buildProject(root, { write: false, additionalEntries: [consumer], incrementalCache: cache, jsInteropProvider: jsxValidationProvider });
		assert.ok(errors(second).some(item => item.code === 'L4307'));
		const importedMain = second.modules.find(module => module.source.path === resolve(root, 'src/main.virune'));
		assert.equal(importedMain?.output, undefined);

		await writeFile(consumer, `pub fn usePage() -> Unit {
	return Unit
}
`, 'utf8');
		const third = await buildProject(root, { write: false, additionalEntries: [consumer], incrementalCache: cache, jsInteropProvider: jsxValidationProvider });
		assert.deepEqual(errors(third), []);
		assert.equal(third.modules.find(module => module.source.path === resolve(root, 'src/main.virune'))?.outputPath, resolve(root, 'dist/main.jsx'));
	});
});
