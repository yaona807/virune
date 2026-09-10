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
	labels: List<String>
}

component Page(config: Config) uses JavaScript {
	return view {
		div()
	}
}
`, 'utf8');
		const result = await buildProject(root, { write: false, jsInteropProvider: jsxValidationProvider });
		assert.ok(errors(result).some(item => item.code === 'L4309' && /frontend JSX emission currently supports/u.test(item.message)));
		const main = result.modules.find(module => module.source.path === resolve(root, 'src/main.virune'));
		assert.equal(main?.output, undefined);
	});
});

test('project build routes imported primitive native components to JSX artifacts', async () => {
	await withProject(async root => {
		await writeFile(join(root, 'src/helper.virune'), `internal fn label() -> String => "ok"

internal component Card(title: String, count: Int, active: Bool) uses JavaScript {
	return view {
		div(title: title) {
			{ title }
		}
	}
}
`, 'utf8');
		await writeFile(join(root, 'src/main.virune'), `import { Card as LocalCard, label } from "./helper.virune"

component Page() uses JavaScript {
	let title = label()
	return view {
		LocalCard(title: title, count: 1, active: true)
	}
}
`, 'utf8');
		const result = await buildProject(root, { write: false, jsInteropProvider: jsxValidationProvider });
		assert.deepEqual(errors(result), []);
		const main = result.modules.find(module => module.source.path === resolve(root, 'src/main.virune'));
		const helper = result.modules.find(module => module.source.path === resolve(root, 'src/helper.virune'));
		assert.equal(main?.outputPath, resolve(root, 'dist/main.jsx'));
		assert.equal(helper?.outputPath, resolve(root, 'dist/helper.jsx'));
		assert.ok(main?.output);
		assert.ok(main.output.code.includes('Card as LocalCard'));
		assert.ok(main.output.code.includes('from "./helper.jsx";'));
		assert.ok(main.output.code.includes('<LocalCard'));
	});
});

test('project build routes primitive-backed newtype props through existing native component signatures', async () => {
	await withProject(async root => {
		await writeFile(join(root, 'src/helper.virune'), `internal newtype UserId = Int

internal fn sampleUserId() -> UserId {
	return UserId.create(7)
}

internal component Card(userId: UserId) uses JavaScript {
	let snapshot = userId
	return view {
		div()
	}
}
`, 'utf8');
		await writeFile(join(root, 'src/main.virune'), `import { Card as LocalCard, sampleUserId } from "./helper.virune"

component Page() uses JavaScript {
	let userId = sampleUserId()
	return view {
		LocalCard(userId: userId)
	}
}
`, 'utf8');
		const result = await buildProject(root, { write: false, jsInteropProvider: jsxValidationProvider });
		assert.deepEqual(errors(result), []);
		const main = result.modules.find(module => module.source.path === resolve(root, 'src/main.virune'));
		const helper = result.modules.find(module => module.source.path === resolve(root, 'src/helper.virune'));
		assert.equal(main?.outputPath, resolve(root, 'dist/main.jsx'));
		assert.equal(helper?.outputPath, resolve(root, 'dist/helper.jsx'));
		assert.ok(main?.output);
		assert.ok(helper?.output);
		assert.ok(main.output.code.includes('Card as LocalCard'));
		assert.ok(main.output.code.includes('from "./helper.jsx";'));
		assert.match(main.output.code, /<LocalCard userId=\{/u);
		assert.ok(helper.output.code.includes(`$viruneValidateSafeFfiValue($props["userId"], { version: 'virune-safe-ffi/v1', type: { kind: 'int' } }, "$.userId")`));
	});
});

test('project build transports scalar record props through existing component routing', async () => {
	await withProject(async root => {
		await writeFile(join(root, 'src/helper.virune'), `internal newtype UserId = Int

internal record User {
	id: UserId
	name: String
	active: Bool
}

internal fn sampleUser() -> User {
	return User {
		id: UserId.create(7),
		name: "Ada",
		active: true,
	}
}

internal component Card(user: User) uses JavaScript {
	let snapshot = user
	return view {
		div()
	}
}
`, 'utf8');
		await writeFile(join(root, 'src/main.virune'), `import { Card as LocalCard, sampleUser } from "./helper.virune"

component Page() uses JavaScript {
	let user = sampleUser()
	return view {
		LocalCard(user: user)
	}
}
`, 'utf8');
		const result = await buildProject(root, { write: false, jsInteropProvider: jsxValidationProvider });
		assert.deepEqual(errors(result), []);
		const main = result.modules.find(module => module.source.path === resolve(root, 'src/main.virune'));
		const helper = result.modules.find(module => module.source.path === resolve(root, 'src/helper.virune'));
		assert.equal(main?.outputPath, resolve(root, 'dist/main.jsx'));
		assert.equal(helper?.outputPath, resolve(root, 'dist/helper.jsx'));
		assert.ok(main?.output);
		assert.ok(helper?.output);
		assert.ok(main.output.code.includes('Card as LocalCard'));
		assert.ok(main.output.code.includes('from "./helper.jsx";'));
		assert.match(main.output.code, /<LocalCard user=\{encodeFfiValue\(user, \{ version: 'virune-safe-ffi\/v1', type: \{ kind: 'record'/u);
		assert.ok(main.output.code.includes(`["id"]: { kind: 'int' }`));
		assert.ok(main.output.code.includes(`["name"]: { kind: 'string' }`));
		assert.ok(main.output.code.includes(`["active"]: { kind: 'bool' }`));
		assert.match(helper.output.code, /\$viruneValidateSafeFfiValue\(\$props\["user"\], \{ version: 'virune-safe-ffi\/v1', type: \{ kind: 'record', name: "User"/u);
	});
});

test('project build transports imported native component children through the existing JSX route', async () => {
	await withProject(async root => {
		await writeFile(join(root, 'src/helper.virune'), `internal component Panel() uses JavaScript {
	return view {
		section() {
			children
		}
	}
}
`, 'utf8');
		await writeFile(join(root, 'src/main.virune'), `import { Panel } from "./helper.virune"

component Page(title: String) uses JavaScript {
	return view {
		Panel() {
			span() {
				{ title }
			}
		}
	}
}
`, 'utf8');
		const result = await buildProject(root, { write: false, jsInteropProvider: jsxValidationProvider });
		assert.deepEqual(errors(result), []);
		const main = result.modules.find(module => module.source.path === resolve(root, 'src/main.virune'));
		const helper = result.modules.find(module => module.source.path === resolve(root, 'src/helper.virune'));
		assert.equal(main?.outputPath, resolve(root, 'dist/main.jsx'));
		assert.equal(helper?.outputPath, resolve(root, 'dist/helper.jsx'));
		assert.ok(main?.output);
		assert.ok(helper?.output);
		assert.ok(main.output.code.includes('from "./helper.jsx";'));
		assert.match(main.output.code, /<Panel \$viruneChildren=\{\(\) => <span>\{\$viruneValidateSafeFfiValue\(\$props\["title"\]/u);
		assert.match(helper.output.code, /const \$slot = \$props\["\$viruneChildren"\]; return \$slot === undefined \? <><\/> : \$slot\(\);/u);
	});
});

test('imported native component props keep the existing fail-closed type checks', async () => {
	await withProject(async root => {
		await writeFile(join(root, 'src/helper.virune'), `internal component Card(title: String, count: Int) uses JavaScript {
	return view {
		div()
	}
}
`, 'utf8');
		await writeFile(join(root, 'src/main.virune'), `import { Card } from "./helper.virune"

component Page() uses JavaScript {
	return view {
		Card(title: "ok", count: 1.5)
	}
}
`, 'utf8');
		const result = await buildProject(root, { write: false, jsInteropProvider: jsxValidationProvider });
		assert.ok(errors(result).some(item => item.code === 'L4308' && /property count has type Float; expected Int/u.test(item.message)));
	});
});

test('imported component modules still require the existing host-prop boundary', async () => {
	await withProject(async root => {
		await writeFile(join(root, 'src/helper.virune'), `internal record Config {
	labels: List<String>
}

internal component Card(config: Config) uses JavaScript {
	return view {
		div()
	}
}
`, 'utf8');
		await writeFile(join(root, 'src/main.virune'), `import { Card } from "./helper.virune"

component Page() uses JavaScript {
	return view {
		div()
	}
}
`, 'utf8');
		const result = await buildProject(root, { write: false, jsInteropProvider: jsxValidationProvider });
		assert.ok(errors(result).some(item => item.code === 'L4309'));
		const helper = result.modules.find(module => module.source.path === resolve(root, 'src/helper.virune'));
		assert.equal(helper?.output, undefined);
	});
});

test('incremental cache follows dependency JS and JSX artifact changes in both directions', async () => {
	await withProject(async root => {
		const helperPath = join(root, 'src/helper.virune');
		const plainHelper = 'internal fn label() -> String => "ok"\n';
		await writeFile(helperPath, plainHelper, 'utf8');
		await writeFile(join(root, 'src/main.virune'), `import { label } from "./helper.virune"

component Page() uses JavaScript {
	return view {
		div(title: label())
	}
}
`, 'utf8');
		const cache = new ProjectBuildCache();
		const first = await buildProject(root, { write: false, incrementalCache: cache, jsInteropProvider: jsxValidationProvider });
		assert.deepEqual(errors(first), []);
		const firstMain = first.modules.find(module => module.source.path === resolve(root, 'src/main.virune'));
		assert.equal(first.modules.find(module => module.source.path === resolve(root, 'src/helper.virune'))?.outputPath, resolve(root, 'dist/helper.js'));
		assert.ok(firstMain?.output?.code.includes('from "./helper.js";'));

		await writeFile(helperPath, `${plainHelper}
component Hidden() uses JavaScript {
	return view {
		div()
	}
}
`, 'utf8');
		const second = await buildProject(root, { write: false, incrementalCache: cache, jsInteropProvider: jsxValidationProvider });
		assert.deepEqual(errors(second), []);
		const secondMain = second.modules.find(module => module.source.path === resolve(root, 'src/main.virune'));
		assert.equal(second.modules.find(module => module.source.path === resolve(root, 'src/helper.virune'))?.outputPath, resolve(root, 'dist/helper.jsx'));
		assert.ok(secondMain?.output?.code.includes('from "./helper.jsx";'));

		await writeFile(helperPath, plainHelper, 'utf8');
		const third = await buildProject(root, { write: false, incrementalCache: cache, jsInteropProvider: jsxValidationProvider });
		assert.deepEqual(errors(third), []);
		const thirdMain = third.modules.find(module => module.source.path === resolve(root, 'src/main.virune'));
		assert.equal(third.modules.find(module => module.source.path === resolve(root, 'src/helper.virune'))?.outputPath, resolve(root, 'dist/helper.js'));
		assert.ok(thirdMain?.output?.code.includes('from "./helper.js";'));
	});
});
