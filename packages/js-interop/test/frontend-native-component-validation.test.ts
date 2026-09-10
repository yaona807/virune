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
	await writeFile(join(root, 'src/jsx.d.ts'), `declare global {
	namespace JSX {
		interface Element { readonly __viruneJsxElement: unique symbol; }
		interface IntrinsicElements { div: {}; span: {}; child: {}; }
	}
}
export {};
`, 'utf8');
	const provider = new TypeScriptInteropProvider({ projectRoot: root });
	try {
		return compileSource({ id: 1, path: join(root, 'src/main.virune'), text }, { emit, platform: 'browser', jsInteropProvider: provider });
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

test('native component prop usage rejects missing, extra, duplicate, and Virune-type-incompatible values', async () => {
	for (const usage of [
		'Card(title: "ok")',
		'Card(title: "ok", count: 1, extra: "no")',
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

test('native component children remain fail-closed until child transport exists', async () => {
	const result = await compile(`component Card() uses JavaScript {
	return view {
		div()
	}
}

component Page() uses JavaScript {
	return view {
		Card() {
			span()
		}
	}
}
`);
	const diagnostic = errors(result).find(item => item.code === 'L4308');
	assert.ok(diagnostic);
	assert.match(diagnostic.message, /children require compiler-managed native child transport/u);
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
