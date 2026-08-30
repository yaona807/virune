import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import {
	compileSource,
	type JsInteropProvider,
} from '@virune/compiler/experimental';
import { TypeScriptInteropProvider } from '../src/index.js';
import { fixtureRoot } from './fixture.js';

async function fixture(declarations: string): Promise<{ readonly root: string; readonly provider: TypeScriptInteropProvider }> {
	const root = await fixtureRoot();
	await writeFile(join(root, 'src/library.d.ts'), declarations, 'utf8');
	return { root, provider: new TypeScriptInteropProvider({ projectRoot: root }) };
}

function providerWithOverrides(
	provider: TypeScriptInteropProvider,
	overrides: Partial<Pick<JsInteropProvider, 'resolveCallUsage' | 'resolveConstructUsage' | 'resolveIndexUsage' | 'resolveWriteUsage' | 'resolveObjectUsage'>>,
): JsInteropProvider {
	const wholeUsageProvider: JsInteropProvider = provider;
	return {
		id: provider.id,
		version: provider.version,
		generation: provider.generation,
		resolveImport: request => provider.resolveImport(request),
		getProperty: (reference, name) => provider.getProperty(reference, name),
		resolveCallUsage: overrides.resolveCallUsage ?? ((reference, usage) => wholeUsageProvider.resolveCallUsage?.(reference, usage)),
		resolveConstructUsage: overrides.resolveConstructUsage ?? ((reference, usage) => wholeUsageProvider.resolveConstructUsage?.(reference, usage)),
		resolveIndexUsage: overrides.resolveIndexUsage ?? ((reference, usage) => wholeUsageProvider.resolveIndexUsage?.(reference, usage)),
		resolveWriteUsage: overrides.resolveWriteUsage ?? ((reference, usage) => wholeUsageProvider.resolveWriteUsage?.(reference, usage)),
		resolveObjectUsage: overrides.resolveObjectUsage ?? ((reference, usage) => wholeUsageProvider.resolveObjectUsage?.(reference, usage)),
		resolveCall: (reference, argumentsList) => provider.resolveCall(reference, argumentsList),
		resolveConstruct: (reference, argumentsList) => provider.resolveConstruct(reference, argumentsList),
		getAwaitedType: reference => provider.getAwaitedType(reference),
		display: reference => provider.display(reference),
	};
}

function compile(root: string, source: string, provider: JsInteropProvider) {
	return compileSource({ id: 1, path: join(root, 'src/main.virune'), text: source }, { platform: 'node', jsInteropProvider: provider });
}

test('stale index result evidence cannot prove an External index read', async () => {
	const { root, provider } = await fixture('export declare const values: Record<string, string>;\n');
	const wholeUsageProvider: JsInteropProvider = provider;
	const wrapped = providerWithOverrides(provider, {
		resolveIndexUsage: (reference, usage) => {
			const resolution = wholeUsageProvider.resolveIndexUsage?.(reference, usage);
			if (resolution === undefined) return undefined;
			return {
				result: {
					...resolution.result,
					ref: { ...resolution.result.ref, generation: resolution.result.ref.generation + 1 },
				},
			};
		},
	});
	const result = compile(root, `import js { values } from "./library.js"

fn main() -> String uses JavaScript {
	return values["key"]
}
`, wrapped);
	assert.ok(result.diagnostics.some(item => item.code === 'L2121'));
});

test('partial contextual object argument evidence cannot prove a JavaScript call', async () => {
	const { root, provider } = await fixture("export declare function consume(value: { mode: 'strict' }): void;\n");
	const wholeUsageProvider: JsInteropProvider = provider;
	const wrapped = providerWithOverrides(provider, {
		resolveCallUsage: (reference, usage) => {
			const resolution = wholeUsageProvider.resolveCallUsage?.(reference, usage);
			return resolution === undefined ? undefined : { ...resolution, objectArguments: [] };
		},
	});
	const result = compile(root, `import js { consume } from "./library.js"

fn main() -> Unit uses JavaScript {
	discard consume({ mode: "strict" })
	return Unit
}
`, wrapped);
	assert.ok(result.diagnostics.some(item => item.code === 'L4204'));
	assert.equal(result.semantic?.interop.usages.some(item => item.kind === 'object'), false);
});

test('partial contextual object write evidence cannot prove a writable facet', async () => {
	const { root, provider } = await fixture("export declare const state: { config: { mode: 'strict' } };\n");
	const wrapped = providerWithOverrides(provider, {
		resolveWriteUsage: () => ({ accepted: true }),
	});
	const result = compile(root, `import js { state } from "./library.js"

fn main() -> Unit uses JavaScript {
	state.config = { mode: "strict" }
	return Unit
}
`, wrapped);
	assert.ok(result.diagnostics.some(item => item.code === 'L2119'));
	assert.equal(result.semantic?.interop.usages.some(item => item.kind === 'object'), false);
});

test('stale contextual object result evidence fails closed before committing object semantics', async () => {
	const { root, provider } = await fixture("export interface Config { mode: 'strict' }\n");
	const wholeUsageProvider: JsInteropProvider = provider;
	const wrapped = providerWithOverrides(provider, {
		resolveObjectUsage: (reference, usage) => {
			const resolution = wholeUsageProvider.resolveObjectUsage?.(reference, usage);
			if (resolution === undefined) return undefined;
			return {
				...resolution,
				result: {
					...resolution.result,
					ref: { ...resolution.result.ref, generation: resolution.result.ref.generation + 1 },
				},
			};
		},
	});
	const result = compile(root, `import js type { Config } from "./library.js"

fn build() -> Config uses JavaScript {
	return { mode: "strict" }
}
`, wrapped);
	assert.ok(result.diagnostics.some(item => item.code === 'L2122'));
	assert.equal(result.semantic?.interop.usages.some(item => item.kind === 'object'), false);
});

test('stale construct result evidence cannot prove construction', async () => {
	const { root, provider } = await fixture('export declare class Box<T> { constructor(value: T); readonly value: T }\n');
	const wholeUsageProvider: JsInteropProvider = provider;
	const wrapped = providerWithOverrides(provider, {
		resolveConstructUsage: (reference, usage) => {
			const resolution = wholeUsageProvider.resolveConstructUsage?.(reference, usage);
			if (resolution === undefined) return undefined;
			return {
				...resolution,
				result: {
					...resolution.result,
					ref: { ...resolution.result.ref, generation: resolution.result.ref.generation + 1 },
				},
			};
		},
	});
	const result = compile(root, `import js { Box } from "./library.js"

fn main() -> Unit uses JavaScript {
	discard Box(1.0)
	return Unit
}
`, wrapped);
	assert.ok(result.diagnostics.some(item => item.code === 'L4204'));
	assert.equal(result.semantic?.interop.usages.some(item => item.kind === 'construct'), false);
});
