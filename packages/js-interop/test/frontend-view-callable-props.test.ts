import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { compileSource } from '@virune/compiler/experimental';
import { TypeScriptInteropProvider } from '../src/index.js';
import { fixtureRoot } from './fixture.js';

async function compile(text: string, emit = false, noUnusedParameters = false) {
	const root = await fixtureRoot();
	await writeFile(join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { jsx: 'preserve', noUnusedLocals: true, noUnusedParameters }, include: ['src/**/*'] }), 'utf8');
	await writeFile(join(root, 'src/library.d.ts'), `declare global {
	namespace JSX {
		interface Element { readonly __viruneJsxElement: unique symbol; }
		interface IntrinsicElements {
			button: {
				onClick?: () => void;
				onNumber?: (value: number) => number;
				onText?: (value: string) => void;
			};
			div: {};
		}
	}
}

export interface Marker { readonly marker: true; }
export interface Item { readonly label: string; }
export const items: readonly Item[];
export const ExternalButton: (props: { onClick: () => void }) => JSX.Element;
export const ExternalList: <T>(props: { items: readonly T[]; children: (item: T) => JSX.Element }) => JSX.Element;
export const ExternalEmptyRenderer: (props: { children: () => JSX.Element }) => JSX.Element;
export const ExternalPair: <T>(props: { items: readonly T[]; primary: (item: T) => JSX.Element; secondary: (item: T) => JSX.Element }) => JSX.Element;
export const ExternalStringRenderer: (props: { children: (item: Item) => string }) => JSX.Element;
export const ExternalAnyRenderer: (props: { children: (item: any) => JSX.Element }) => JSX.Element;
export function ExternalOverloaded(props: { mode: "a"; children: (item: Item) => JSX.Element }): JSX.Element;
export function ExternalOverloaded(props: { mode: "b"; children: (item: Item) => JSX.Element }): JSX.Element;
export function setMode(value: string): void;
`, 'utf8');
	const provider = new TypeScriptInteropProvider({ projectRoot: root });
	try {
		return compileSource({ id: 1, path: join(root, 'src/main.virune'), text: `import js type { Marker } from "./library.js"\n${text}` }, { emit, platform: 'browser', jsInteropProvider: provider });
	} finally {
		provider.dispose();
	}
}

const errors = (result: Awaited<ReturnType<typeof compile>>) => result.diagnostics.filter(item => item.severity === 'error');


async function compileIntrinsicWithoutViruneJavaScriptImport(text: string, emit = false) {
	const root = await fixtureRoot();
	await mkdir(join(root, 'src/jsx'), { recursive: true });
	await writeFile(join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { jsx: 'react-jsx', jsxImportSource: './jsx', noUnusedLocals: true }, include: ['src/**/*'] }), 'utf8');
	await writeFile(join(root, 'src/jsx/jsx-runtime.d.ts'), `export namespace JSX {
	interface Element { readonly __viruneJsxElement: unique symbol; }
	interface IntrinsicElements { button: { onClick?: () => void }; }
}
export function jsx(type: unknown, props: unknown, key?: unknown): JSX.Element;
export const jsxs: typeof jsx;
export const Fragment: unknown;
`, 'utf8');
	const provider = new TypeScriptInteropProvider({ projectRoot: root });
	try {
		return compileSource({ id: 1, path: join(root, 'src/main.virune'), text }, { emit, platform: 'browser', jsInteropProvider: provider });
	} finally {
		provider.dispose();
	}
}

test('intrinsic View callback props reuse the existing callable shim', async () => {
	const result = await compile(`fn handle() -> Unit {
	return Unit
}

component Page() uses JavaScript {
	return view {
		button(onClick: handle)
	}
}
`, true);
	assert.deepEqual(errors(result), []);
	assert.ok(result.output);
	assert.match(result.output.code, /<button onClick=\{\$viruneProjectCallable\(handle,/u);
	assert.equal(result.semantic?.frontendCallableProjections.length, 1);
	assert.deepEqual(result.semantic?.frontendCallableProjections[0]?.descriptor, {
		version: 'virune-callable-shim/v1',
		parameters: [],
		result: 'Unit',
		async: false,
		effects: [],
		contextMode: 'root-argument',
	});
});

test('JavaScript-imported component callback props use the same projection', async () => {
	const result = await compile(`import js { ExternalButton } from "./library.js"

fn handle() -> Unit {
	return Unit
}

component Page() uses JavaScript {
	return view {
		ExternalButton(onClick: handle)
	}
}
`, true);
	assert.deepEqual(errors(result), []);
	assert.ok(result.output);
	assert.match(result.output.code, /<ExternalButton onClick=\{\$viruneProjectCallable\(handle,/u);
	assert.equal(result.semantic?.frontendCallableProjections.length, 1);
});

test('zero-argument inline View callback props reuse the existing callable shim with captures and root context', async () => {
	const result = await compile(`import js { setMode } from "./library.js"

component Page() uses JavaScript {
	let label = "captured"
	return view {
		button(onClick: fn() -> Unit uses JavaScript {
			discard setMode(label)
			return Unit
		})
	}
}
`, true);
	assert.deepEqual(errors(result), []);
	assert.ok(result.output);
	const code = result.output.code;
	assert.match(code, /<button onClick=\{\$viruneProjectCallable\(\(\(\$lambdaCtx\d+ = rootTaskContext\(\)\) => \{/u);
	assert.match(code, /\$viruneProjectCallable\(\(\(\$lambdaCtx\d+ = rootTaskContext\(\)\) => \{[\s\S]*?setMode\(label\)[\s\S]*?\}\),/u);
	assert.equal(result.semantic?.frontendCallableProjections.length, 1);
	assert.deepEqual(result.semantic?.frontendCallableProjections[0]?.descriptor, {
		version: 'virune-callable-shim/v1',
		parameters: [],
		result: 'Unit',
		async: false,
		effects: ['JavaScript'],
		contextMode: 'root-argument',
	});
});

test('External JSX contextual View callbacks use sibling props for generic parameter evidence', async () => {
	const result = await compile(`import js { ExternalList, items } from "./library.js"

component Page() uses JavaScript {
	return view {
		ExternalList(items: items, children: fn(item) uses JavaScript => view {
			div() {
				{ item.label }
			}
		})
	}
}
`, true, true);
	assert.deepEqual(errors(result), []);
	assert.ok(result.output);
	assert.equal(result.semantic?.frontendCallableProjections.length, 1);
	assert.deepEqual(result.semantic?.frontendCallableProjections[0]?.viewCallback, {
		parameterCount: 1,
		effects: ['JavaScript'],
	});
	assert.match(result.output.code, /<ExternalList items=\{items\} children=\{\$viruneProjectCallable\(/u);
	assert.match(result.output.code, /return <div>\{item\.label\}<\/div>;/u);
	assert.ok(result.output.code.includes('virune-frontend-view-callback\\u002Fv1'));
});

test('zero-parameter External JSX contextual View callbacks remain compiler-controlled', async () => {
	const result = await compile(`import js { ExternalEmptyRenderer } from "./library.js"

component Page() uses JavaScript {
	return view {
		ExternalEmptyRenderer(children: fn() uses JavaScript => view {
			div()
		})
	}
}
`, true, true);
	assert.deepEqual(errors(result), []);
	assert.ok(result.output);
	assert.deepEqual(result.semantic?.frontendCallableProjections[0]?.viewCallback, {
		parameterCount: 0,
		effects: ['JavaScript'],
	});
	assert.match(result.output.code, /<ExternalEmptyRenderer children=\{\$viruneProjectCallable\(/u);
	assert.match(result.output.code, /\$fn\(rootTaskContext\(\)\)/u);
});

test('multiple contextual View callback properties preserve sibling generic evidence', async () => {
	const result = await compile(`import js { ExternalPair, items } from "./library.js"

component Page() uses JavaScript {
	return view {
		ExternalPair(
			items: items,
			primary: fn(item) uses JavaScript => view {
				div() {
					{ item.label }
				}
			},
			secondary: fn(item) uses JavaScript => view {
				div() {
					{ item.label }
				}
			}
		)
	}
}
`, true, true);
	assert.deepEqual(errors(result), []);
	assert.ok(result.output);
	assert.equal(result.semantic?.frontendCallableProjections.filter(item => item.viewCallback !== undefined).length, 2);
	assert.match(result.output.code, /<ExternalPair items=\{items\} primary=\{\$viruneProjectCallable\(/u);
	assert.match(result.output.code, /secondary=\{\$viruneProjectCallable\(/u);
});

test('External JSX contextual View callback parameters fail closed on any evidence', async () => {
	const result = await compile(`import js { ExternalAnyRenderer } from "./library.js"

component Page() uses JavaScript {
	return view {
		ExternalAnyRenderer(children: fn(item) uses JavaScript => view {
			div()
		})
	}
}
`);
	assert.ok(errors(result).some(item => item.code === 'L4308'));
	assert.equal(result.semantic?.frontendCallableProjections.length, 0);
});

test('External JSX contextual View callbacks reject ambiguous component overloads', async () => {
	const result = await compile(`import js { ExternalOverloaded } from "./library.js"

component Page() uses JavaScript {
	return view {
		ExternalOverloaded(mode: "a", children: fn(item) uses JavaScript => view {
			div() {
				{ item.label }
			}
		})
	}
}
`);
	assert.ok(errors(result).some(item => item.code === 'L4308'));
	assert.equal(result.semantic?.frontendCallableProjections.length, 0);
});

test('External JSX contextual View callbacks retain actual result validation', async () => {
	const result = await compile(`import js { ExternalStringRenderer } from "./library.js"

component Page() uses JavaScript {
	return view {
		ExternalStringRenderer(children: fn(item) uses JavaScript => view {
			div() {
				{ item.label }
			}
		})
	}
}
`);
	assert.ok(errors(result).some(item => item.code === 'L4308'));
});

test('View-producing External JSX callbacks reject explicit Virune return types', async () => {
	const result = await compile(`import js { ExternalStringRenderer } from "./library.js"

component Page() uses JavaScript {
	return view {
		ExternalStringRenderer(children: fn(item) -> String uses JavaScript => view {
			div()
		})
	}
}
`);
	assert.ok(errors(result).some(item => item.code === 'L4300' && item.message.includes('cannot declare a Virune return type')));
	assert.equal(result.semantic?.frontendCallableProjections.length, 0);
});

test('async View-producing External JSX callbacks remain fail closed', async () => {
	const result = await compile(`import js { ExternalStringRenderer } from "./library.js"

component Page() uses JavaScript {
	return view {
		ExternalStringRenderer(children: async fn(item) uses JavaScript => view {
			div()
		})
	}
}
`);
	assert.ok(errors(result).some(item => item.code === 'L4300'));
	assert.equal(result.semantic?.frontendCallableProjections.length, 0);
});

test('View-producing lambdas remain rejected outside the External JSX property boundary', async () => {
	const result = await compile(`component Page() uses JavaScript {
	let render = fn(value: String) => view {
		div()
	}
	return view {
		div()
	}
}
`);
	assert.ok(errors(result).some(item => item.code === 'L4300'));
});

test('TypeScript JSX whole-usage proof rejects incompatible projected callbacks', async () => {
	const result = await compile(`fn handle(value: Float) -> Unit {
	return Unit
}

component Page() uses JavaScript {
	return view {
		button(onText: handle)
	}
}
`);
	assert.ok(errors(result).some(item => item.code === 'L4308'));
});

test('Int callback parameters remain fail-closed because TypeScript number does not prove Virune Int', async () => {
	const result = await compile(`fn handle(value: Int) -> Int {
	return value
}

component Page() uses JavaScript {
	return view {
		button(onNumber: handle)
	}
}
`);
	assert.ok(errors(result).some(item => item.code === 'L4308'));
	assert.equal(result.semantic?.frontendCallableProjections.length, 0);
});

test('generic native functions remain fail-closed as View callback props', async () => {
	const result = await compile(`fn identity<T>(value: T) -> T {
	return value
}

component Page() uses JavaScript {
	return view {
		button(onNumber: identity)
	}
}
`);
	assert.ok(errors(result).some(item => item.code === 'L4308'));
	assert.equal(result.semantic?.frontendCallableProjections.length, 0);
});

test('contextual View callback proof and emission are deterministic', async () => {
	const source = `import js { ExternalList, items } from "./library.js"

component Page() uses JavaScript {
	return view {
		ExternalList(items: items, children: fn(item) uses JavaScript => view {
			div() {
				{ item.label }
			}
		})
	}
}
`;
	const first = await compile(source, true, true);
	const second = await compile(source, true, true);
	assert.deepEqual(errors(first), []);
	assert.deepEqual(errors(second), []);
	assert.deepEqual(first.semantic?.frontendCallableProjections, second.semantic?.frontendCallableProjections);
	assert.equal(first.output?.code, second.output?.code);
});

test('frontend callable projection evidence and emission are deterministic', async () => {
	const source = `fn handle() -> Unit {
	return Unit
}

component Page() uses JavaScript {
	return view {
		button(onClick: handle)
	}
}
`;
	const first = await compile(source, true);
	const second = await compile(source, true);
	assert.deepEqual(errors(first), []);
	assert.deepEqual(errors(second), []);
	assert.deepEqual(first.semantic?.frontendCallableProjections, second.semantic?.frontendCallableProjections);
	assert.equal(first.output?.code, second.output?.code);
});


test('intrinsic callback projection emits the complete callable boundary without a Virune JavaScript import', async () => {
	const result = await compileIntrinsicWithoutViruneJavaScriptImport(`fn handle() -> Unit {
	return Unit
}

component Page() uses JavaScript {
	return view {
		button(onClick: handle)
	}
}
`, true);
	assert.deepEqual(errors(result), []);
	assert.ok(result.output);
	assert.match(result.output.code, /function \$viruneProjectCallable\(/u);
	assert.match(result.output.code, /function \$viruneExternalizeInteropError\(/u);
	assert.match(result.output.code, /<button onClick=\{\$viruneProjectCallable\(handle,/u);
});
