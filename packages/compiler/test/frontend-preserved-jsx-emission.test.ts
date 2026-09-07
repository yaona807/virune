import assert from 'node:assert/strict';
import test from 'node:test';
import { compileSource } from '../src/compiler.js';
import type { JsInteropProvider } from '../src/interop/types.js';

const source = (text: string) => ({ id: 1, path: 'frontend-emission.virune', text });
const jsxValidationProvider: JsInteropProvider = {
	id: 'frontend-emission-test',
	version: '1',
	generation: 1,
	resolveImport: () => { throw new Error('unexpected import'); },
	getProperty: () => undefined,
	resolveCall: () => undefined,
	resolveConstruct: () => undefined,
	getAwaitedType: () => undefined,
	display: () => '<unused>',
	resolveJsxUsage: () => ({ accepted: true }),
};
const externalJsxProvider: JsInteropProvider = {
	id: 'frontend-external-test',
	version: '1',
	generation: 1,
	resolveImport(request) {
		const importedName = request.importedName ?? 'value';
		return {
			type: {
				ref: { providerId: 'frontend-external-test', generation: 1, id: importedName },
				display: importedName,
				category: importedName === 'Card' ? 'function' : 'object',
				origin: { moduleSpecifier: request.moduleSpecifier, exportName: importedName },
			},
			runtime: { kind: 'named', importedName },
			witness: {
				moduleSpecifier: request.moduleSpecifier,
				runtimeEntry: 'library.js',
				runtimeFormat: 'esm',
				conditions: ['import'],
				platform: request.platform,
				providerVersion: '1',
			},
		};
	},
	getProperty: () => undefined,
	resolveCall: () => undefined,
	resolveConstruct: () => undefined,
	getAwaitedType: () => undefined,
	display: type => type.id,
	resolveJsxUsage: () => ({ accepted: true }),
};

function compile(text: string, outputFile?: string) {
	return compileSource(source(text), {
		jsInteropProvider: jsxValidationProvider,
		...(outputFile === undefined ? {} : { outputFile }),
	});
}

test('single-file components emit preserved JSX and a matching default JSX source map', () => {
	const result = compile(`internal component Card() uses JavaScript {
	return view {
		main(class: "page", "data-state": "ready", "a:b": "namespaced") {
			"hello"
			span()
		}
	}
}
`);
	assert.deepEqual(result.diagnostics.filter(item => item.severity === 'error'), []);
	assert.ok(result.output);
	assert.match(result.output.code, /export function Card\(\$props\)/u);
	assert.match(result.output.code, /const \$ctx = rootTaskContext\(\);/u);
	assert.ok(result.output.code.includes('return <main class={"page"} data-state={"ready"} a:b={"namespaced"}>{"hello"}<span /></main>;'));
	assert.ok(result.output.code.endsWith('//# sourceMappingURL=frontend-emission.jsx.map\n'));
	assert.equal(JSON.parse(result.output.map).file, 'frontend-emission.jsx');
});

test('JavaScript-imported External and dotted tags preserve their checked source shape', () => {
	const result = compileSource(source(`import js { Card, ui } from "./library.js"

component Page() uses JavaScript {
	return view {
		Card(label: "ok") {
			"hello"
		}
		ui.Tile(tone: "warm")
	}
}
`), { jsInteropProvider: externalJsxProvider });
	assert.deepEqual(result.diagnostics.filter(item => item.severity === 'error'), []);
	assert.ok(result.output);
	assert.ok(result.output.code.includes('import { Card, ui } from "./library.js";'));
	assert.ok(result.output.code.includes('return <><Card label={"ok"}>{"hello"}</Card><ui.Tile tone={"warm"} /></>;'));
});

test('primitive component props stay host-backed and use existing safe FFI descriptors', () => {
	const result = compile(`fn normalize(value: String) -> String {
	return value
}

internal component Details(title: String, count: Int, ready: Bool, ratio: Float, id: BigInt) uses JavaScript {
	let snapshot = title
	return view {
		main(title: title |> normalize, count: count, ready: ready, ratio: ratio, id: id) {
			{ title }
			{ snapshot }
			if ready {
				span() {
					{ count + 1 }
				}
			} else {
				span() {
					{ ratio }
				}
			}
		}
	}
}
`);
	assert.deepEqual(result.diagnostics.filter(item => item.severity === 'error'), []);
	assert.ok(result.output);
	const code = result.output.code;
	for (const [name, kind] of [
		['title', 'string'],
		['count', 'int'],
		['ready', 'bool'],
		['ratio', 'float'],
		['id', 'bigint'],
	] as const) {
		assert.ok(code.includes(`$viruneValidateSafeFfiValue($props["${name}"], { version: 'virune-safe-ffi/v1', type: { kind: '${kind}' } }, "$.${name}")`), `${name} bridge`);
	}
	assert.ok((code.match(/\$props\["title"\]/gu) ?? []).length >= 3);
	assert.ok(code.includes('const snapshot = $viruneValidateSafeFfiValue($props["title"]'));
	assert.ok(code.includes('normalize($viruneValidateSafeFfiValue($props["title"]'));
	assert.ok(!code.includes('|>'));
	assert.ok(!code.includes('const title ='));
	assert.ok(!code.includes('const {'));
	assert.match(code, /\? <span>\{intAdd\(/u);
	assert.match(code, /: <span>\{/u);
});

test('unsupported component parameter transport fails closed before emission', () => {
	for (const [declaration, type] of [
		['record User {\n\tname: String\n}\n\n', 'User'],
		['', 'Unknown'],
		['', 'List<Int>'],
	] as const) {
		const result = compile(`${declaration}component Card(value: ${type}) uses JavaScript {
	return view {
		main()
	}
}
`);
		assert.ok(result.diagnostics.some(item => item.code === 'L4309' && item.severity === 'error'), type);
		assert.equal(result.output, undefined);
	}
});

test('explicit single-file output artifact names remain authoritative', () => {
	const result = compile(`component Card() uses JavaScript {
	return view {
		main()
	}
}
`, '/workspace/card.js');
	assert.deepEqual(result.diagnostics.filter(item => item.severity === 'error'), []);
	assert.ok(result.output);
	assert.ok(result.output.code.endsWith('//# sourceMappingURL=card.js.map\n'));
	assert.equal(JSON.parse(result.output.map).file, 'card.js');
});
