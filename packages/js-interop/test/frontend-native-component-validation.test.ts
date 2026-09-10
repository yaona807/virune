import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { compileSource } from '@virune/compiler/experimental';
import { TypeScriptInteropProvider } from '../src/index.js';
import { fixtureRoot } from './fixture.js';

async function compile(text: string, emit = false) {
	const root = await fixtureRoot();
	await writeFile(join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { jsx: 'preserve', noUnusedLocals: true }, include: ['src/**/*'] }), 'utf8');
	await writeFile(join(root, 'src/library.d.ts'), `declare global {
	namespace JSX {
		interface Element { readonly __viruneJsxElement: unique symbol; }
		interface IntrinsicElements { div: {}; span: {}; child: {}; }
	}
	const Card: (props: { ambient: true }) => JSX.Element;
}

export interface Marker { readonly marker: true; }
export const ExternalCard: (props: { children?: unknown }) => JSX.Element;
`, 'utf8');
	const provider = new TypeScriptInteropProvider({ projectRoot: root });
	try {
		return compileSource({ id: 1, path: join(root, 'src/main.virune'), text: `import js type { Marker } from "./library.js"\n${text}` }, { emit, platform: 'browser', jsInteropProvider: provider });
	} finally {
		provider.dispose();
	}
}

const errors = (result: Awaited<ReturnType<typeof compile>>) => result.diagnostics.filter(item => item.severity === 'error');

test('same-module native component tags use checked primitive props and preserved JSX emission', async () => {
	const result = await compile(`component Card(title: String, count: Int, active: Bool) uses JavaScript {
	return view {
		div()
	}
}

component Page(title: String) uses JavaScript {
	return view {
		Card(title: title, count: 1, active: true)
	}
}
`, true);
	assert.deepEqual(errors(result), []);
	assert.ok(result.output);
	assert.match(result.output.code, /function Card\(\$props\)/u);
	assert.match(result.output.code, /<Card title=\{/u);
});

test('same-module native component props accept direct primitive-backed newtypes', async () => {
	const result = await compile(`newtype UserId = Int

component Card(userId: UserId) uses JavaScript {
	let snapshot = userId
	return view {
		div()
	}
}

component Page() uses JavaScript {
	let userId = UserId.create(7)
	return view {
		Card(userId: userId)
	}
}
`, true);
	assert.deepEqual(errors(result), []);
	assert.ok(result.output);
	assert.match(result.output.code, /<Card userId=\{/u);
	assert.ok(result.output.code.includes(`$viruneValidateSafeFfiValue($props["userId"], { version: 'virune-safe-ffi/v1', type: { kind: 'int' } }, "$.userId")`));
});

test('native component newtype props preserve nominal assignability', async () => {
	for (const [value, expected] of [
		['7', /property userId has type Int; expected UserId/u],
		['OrderId.create(7)', /property userId has type OrderId; expected UserId/u],
	] as const) {
		const result = await compile(`newtype UserId = Int
newtype OrderId = Int

component Card(userId: UserId) uses JavaScript {
	return view {
		div()
	}
}

component Page() uses JavaScript {
	return view {
		Card(userId: ${value})
	}
}
`);
		assert.ok(errors(result).some(item => item.code === 'L4308' && expected.test(item.message)), value);
	}
});

test('unsupported native component newtypes remain outside the host-prop boundary', async () => {
	for (const { declaration, type } of [
		{ declaration: 'newtype Payload = Unknown', type: 'Payload' },
		{ declaration: '@mustUse\nnewtype Payload = Int', type: 'Payload' },
		{ declaration: '', type: 'Byte' },
	] as const) {
		const result = await compile(`${declaration}

component Card(payload: ${type}) uses JavaScript {
	return view {
		div()
	}
}
`, true);
		const diagnostic = errors(result).find(item => item.code === 'L4309');
		assert.ok(diagnostic, type);
		assert.match(diagnostic.message, /direct non-mustUse source newtypes backed by those primitives/u);
	}
});

test('native component prop usage rejects missing, extra, duplicate, synthetic, and Virune-type-incompatible values', async () => {
	for (const usage of [
		'Card(title: "ok")',
		'Card(title: "ok", count: 1, extra: "no")',
		'Card(title: "ok", count: 1, "$viruneChildren": "no")',
		'Card(title: "ok", count: 1, count: 2)',
		'Card(title: "ok", count: 1.5)',
	]) {
		const result = await compile(`component Card(title: String, count: Int) uses JavaScript {
	return view {
		div()
	}
}

component Page() uses JavaScript {
	return view {
		${usage}
	}
}
`);
		assert.ok(errors(result).some(item => item.code === 'L4308'), usage);
	}
});

test('unsupported native component prop shapes remain outside the proof boundary', async () => {
	const result = await compile(`record Config {
	label: String
}

component Card(config: Config) uses JavaScript {
	return view {
		div()
	}
}

component Page() uses JavaScript {
	return view {
		Card()
	}
}
`);
	const diagnostic = errors(result).find(item => item.code === 'L4308');
	assert.ok(diagnostic);
	assert.match(diagnostic.message, /requires a native component boundary/u);
});

test('native component children use a lazy compiler-managed slot', async () => {
	const result = await compile(`component Card() uses JavaScript {
	return view {
		div() {
			children
		}
	}
}

component Page(title: String) uses JavaScript {
	return view {
		Card() {
			span() {
				{ title }
			}
		}
	}
}
`, true);
	assert.deepEqual(errors(result), []);
	assert.ok(result.output);
	assert.match(result.output.code, /<Card \$viruneChildren=\{\(\) => <span>\{\$viruneValidateSafeFfiValue\(\$props\["title"\]/u);
	assert.match(result.output.code, /const \$slot = \$props\["\$viruneChildren"\]; return \$slot === undefined \? <><\/> : \$slot\(\);/u);
});

test('native component children slot contributes zero children when no block is supplied', async () => {
	const result = await compile(`component Card() uses JavaScript {
	return view {
		div() {
			children
		}
	}
}

component Page() uses JavaScript {
	return view {
		Card()
	}
}
`, true);
	assert.deepEqual(errors(result), []);
	assert.ok(result.output);
	assert.match(result.output.code, /return \$slot === undefined \? <><\/> : \$slot\(\);/u);
});

test('native component may forward its compiler-managed children slot', async () => {
	const result = await compile(`component Inner() uses JavaScript {
	return view {
		div() {
			children
		}
	}
}

component Outer() uses JavaScript {
	return view {
		Inner() {
			children
		}
	}
}

component Page() uses JavaScript {
	return view {
		Outer() {
			span()
		}
	}
}
`, true);
	assert.deepEqual(errors(result), []);
	assert.ok(result.output);
	assert.ok((result.output.code.match(/\$viruneChildren=\{\(\) => /gu) ?? []).length >= 2);
});

test('compiler-managed children slot does not become a direct External component child value', async () => {
	const result = await compile(`import js { ExternalCard } from "./library.js"

component Wrapper() uses JavaScript {
	return view {
		ExternalCard() {
			children
		}
	}
}
`);
	const diagnostic = errors(result).find(item => item.code === 'L4308');
	assert.ok(diagnostic);
	assert.match(diagnostic.message, /compiler-managed children slot beneath JavaScript-imported External component ExternalCard/u);
});

test('compiler-managed children slot remains valid beneath an intrinsic inside an External component', async () => {
	const result = await compile(`import js { ExternalCard } from "./library.js"

component Wrapper() uses JavaScript {
	return view {
		ExternalCard() {
			div() {
				children
			}
		}
	}
}
`, true);
	assert.deepEqual(errors(result), []);
	assert.ok(result.output);
	assert.match(result.output.code, /<ExternalCard><div>\{\(\(\) => \{ const \$slot = \$props\["\$viruneChildren"\]/u);
});

test('lowercase native component tags remain distinct from JSX intrinsic tags', async () => {
	const result = await compile(`component child() uses JavaScript {
	return view {
		div()
	}
}

component Page() uses JavaScript {
	return view {
		child()
	}
}
`);
	const diagnostic = errors(result).find(item => item.code === 'L4308');
	assert.ok(diagnostic);
	assert.match(diagnostic.message, /lowercase Virune-native component tag child would be interpreted as a JSX intrinsic tag/u);
});
