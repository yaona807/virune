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
			"{{ready}}"
			span()
		}
	}
}
`);
	assert.deepEqual(result.diagnostics.filter(item => item.severity === 'error'), []);
	assert.ok(result.output);
	assert.match(result.output.code, /export function Card\(\$props\)/u);
	assert.match(result.output.code, /const \$ctx = rootTaskContext\(\);/u);
	assert.ok(result.output.code.includes('return <main class={"page"} data-state={"ready"} a:b={"namespaced"}>{"hello"}{"{ready}"}<span /></main>;'));
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

test('View conditionals without else preserve zero-child absence in JSX proof and emission', () => {
	let proofSource = '';
	const provider: JsInteropProvider = {
		...jsxValidationProvider,
		resolveJsxUsage(usage) {
			proofSource = usage.sourceText;
			return { accepted: true };
		},
	};
	const result = compileSource(source(`component Card(ready: Bool, nested: Bool) uses JavaScript {
	return view {
		if ready {
			span()
		}
		main() {
			if nested {
				strong()
			}
		}
	}
}
`), { jsInteropProvider: provider });
	assert.deepEqual(result.diagnostics.filter(item => item.severity === 'error'), []);
	assert.ok(result.output);
	assert.ok(proofSource.includes('{(false as boolean) ? <span /> : <></>}'));
	assert.ok(proofSource.includes('<main>{(false as boolean) ? <strong /> : <></>}</main>'));
	assert.ok(result.output.code.includes('? <span /> : <></>'));
	assert.ok(result.output.code.includes('? <strong /> : <></>}'));
});

test('View repetition emits one flat compiler-owned sequence without overrideable collection helpers', () => {
	let proofSource = '';
	const provider: JsInteropProvider = {
		...jsxValidationProvider,
		resolveJsxUsage(usage) {
			proofSource = usage.sourceText;
			return { accepted: true };
		},
	};
	const result = compileSource(source(`component ListView() uses JavaScript {
	let items = [1, 2]
	return view {
		for item, index in items {
			span(value: item)
			if index > 0 {
				strong(position: index)
			}
			for nested in items {
				em(value: nested)
			}
		}
	}
}
`), { jsInteropProvider: provider });
	assert.deepEqual(result.diagnostics.filter(item => item.severity === 'error'), []);
	assert.ok(result.output);
	const code = result.output.code;
	assert.equal((code.match(/const \$viewChildren\d+ = \[\];/gu) ?? []).length, 1);
	assert.equal((code.match(/const \$viewSource\d+ = items;/gu) ?? []).length, 2);
	assert.match(code, /const \$viewLength\d+ = \$viewSource\d+\.length;/u);
	assert.match(code, /for \(let \$viewIndex\d+ = 0; \$viewIndex\d+ < \$viewLength\d+; \$viewIndex\d+\+\+\) \{/u);
	assert.match(code, /const item = \$viewSource\d+\[\$viewIndex\d+\];/u);
	assert.match(code, /const index = \$viewIndex\d+;/u);
	assert.ok(code.includes('.push(<span value={item} />);'));
	assert.ok(code.includes('.push(<strong position={index} />);'));
	assert.ok(code.includes('.push(<em value={nested} />);'));
	assert.ok(!code.includes('.map('));
	assert.ok(!code.includes('<></>'));
	assert.ok(proofSource.includes('$viruneViewChildren'));
	assert.ok(proofSource.includes('.push(<span value={$viruneViewItem'));
	assert.ok(!proofSource.includes('.map('));
});

test('no-else conditional fails closed when an empty fragment would become an observable External child', () => {
	const direct = compileSource(source(`import js { Card } from "./library.js"

component Page(flag: Bool) uses JavaScript {
	return view {
		Card(label: "ok") {
			if flag {
				"hello"
			}
		}
	}
}
`), { jsInteropProvider: externalJsxProvider });
	assert.ok(direct.diagnostics.some(item => item.code === 'L4308' && item.severity === 'error' && /empty fragment observable as a child/u.test(item.message)));
	assert.equal(direct.output, undefined);

	const nestedIntrinsic = compileSource(source(`import js { Card } from "./library.js"

component Page(flag: Bool) uses JavaScript {
	return view {
		Card(label: "ok") {
			main() {
				if flag {
					span()
				}
			}
		}
	}
}
`), { jsInteropProvider: externalJsxProvider });
	assert.deepEqual(nestedIntrinsic.diagnostics.filter(item => item.severity === 'error'), []);
	assert.ok(nestedIntrinsic.output);
	assert.ok(nestedIntrinsic.output.code.includes('? <span /> : <></>}</main>'));
});

test('host-backed component props cannot bypass use-site validation through string interpolation', () => {
	const direct = compile(`component Card(title: String) uses JavaScript {
	return view {
		main(label: "Hello {title}")
	}
}
`);
	assert.ok(direct.diagnostics.some(item => item.code === 'L4309' && item.severity === 'error' && /string interpolation/u.test(item.message)));
	assert.equal(direct.output, undefined);

	const snapshot = compile(`component Card(title: String) uses JavaScript {
	let localTitle = title
	return view {
		main(label: "Hello {localTitle}")
	}
}
`);
	assert.deepEqual(snapshot.diagnostics.filter(item => item.severity === 'error'), []);
	assert.ok(snapshot.output);
	assert.ok(snapshot.output.code.includes('const localTitle = $viruneValidateSafeFfiValue($props["title"]'));
	assert.ok(snapshot.output.code.includes('label={`Hello ${localTitle}`}'));
});

test('interpolated View text fails closed instead of inventing text-child name resolution', () => {
	const result = compile(`component Card(title: String) uses JavaScript {
	let localTitle = title
	return view {
		main() {
			"Hello {localTitle}"
		}
	}
}
`);
	assert.ok(result.diagnostics.some(item => item.code === 'L4309' && item.severity === 'error' && /explicit View expression child/u.test(item.message)));
	assert.equal(result.output, undefined);
});

test('JSX proof widens interpolated strings and normalizes escaped braces like emission', () => {
	let proofSource = '';
	const provider: JsInteropProvider = {
		...jsxValidationProvider,
		resolveJsxUsage(usage) {
			proofSource = usage.sourceText;
			return { accepted: true };
		},
	};
	const result = compileSource(source(`component Card(title: String) uses JavaScript {
	return view {
		main(label: "Hello {title}", brace: "{{ready}}") {
			"{{child}}"
			"Hello {title}"
		}
	}
}
`), { emit: false, jsInteropProvider: provider });
	assert.deepEqual(result.diagnostics.filter(item => item.severity === 'error'), []);
	assert.ok(proofSource.includes('label={("" as string)}'));
	assert.ok(proofSource.includes('brace={"{ready}"}'));
	assert.ok(proofSource.includes('>{"{child}"}{("" as string)}</main>'));
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
