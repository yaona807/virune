import assert from 'node:assert/strict';
import test from 'node:test';
import { compileSource } from '../src/compiler.js';
import type { JsInteropProvider } from '../src/interop/types.js';

const source = (text: string) => ({ id: 1, path: 'view-repetition-deferred-safety.virune', text });
const provider: JsInteropProvider = {
	id: 'view-repetition-deferred-safety-test',
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

function externalCaptureProvider(category: 'object' | 'unknown' | 'any' = 'object', mustUse?: boolean, callable = false): JsInteropProvider {
	return {
		...provider,
		resolveImport(request) {
			return {
				type: {
					ref: { providerId: provider.id, generation: provider.generation, id: 'external-value' },
					display: 'ExternalValue',
					category,
					...(mustUse === undefined ? {} : { mustUse }),
					origin: { moduleSpecifier: request.moduleSpecifier, exportName: request.importedName ?? 'externalValue' },
				},
				runtime: { kind: 'named', importedName: request.importedName ?? 'externalValue' },
				witness: {
					moduleSpecifier: request.moduleSpecifier,
					runtimeEntry: 'dist/library.js',
					runtimeFormat: 'esm',
					conditions: ['import', 'node'],
					platform: request.platform,
					providerVersion: 'view-repetition-deferred-safety-test-1',
				},
			};
		},
		resolveCall: callable
			? () => ({
				result: {
					ref: { providerId: provider.id, generation: provider.generation, id: 'external-call-result' },
					display: 'string',
					category: 'primitive',
					primitive: 'string',
				},
				parameterCount: 0,
				optionalParameterCount: 0,
				rest: false,
				mayReject: false,
				receiverMode: 'none',
			})
			: () => undefined,
	};
}

const externalProvider = externalCaptureProvider();

function compile(text: string, jsInteropProvider: JsInteropProvider = provider) {
	return compileSource(source(text), { jsInteropProvider });
}

function codes(result: ReturnType<typeof compile>): string[] {
	return result.diagnostics.filter(item => item.severity === 'error').map(item => item.code);
}

// @virune-rule {"id":"frontend.view-repetition","runner":"unit","file":"packages/compiler/test/view-repetition-deferred-safety.test.ts","case":"Host-deferred repetition accepts immutable frontend-safe captures","kind":"positive","platform":"common"}
test('Host-deferred repetition accepts immutable frontend-safe captures', () => {
	const result = compile(`component ListView() uses JavaScript {
	let items = [1, 2]
	let prefix = "row"
	return view {
		for item in items by item {
			span() {
				{ prefix }
				{ item }
			}
		}
	}
}
`);
	assert.deepEqual(result.diagnostics.filter(item => item.severity === 'error'), []);
	assert.ok(result.output);
});

// @virune-rule {"id":"frontend.view-repetition","runner":"unit","file":"packages/compiler/test/view-repetition-deferred-safety.test.ts","case":"Host-deferred repetition rejects mutable snapshot-source captures","kind":"negative","platform":"common"}
test('Host-deferred repetition rejects mutable snapshot-source captures', () => {
	const result = compile(`component ListView() uses JavaScript {
	let mut items = [1, 2]
	return view {
		for item in items by item {
			span() { { item } }
		}
	}
}
`);
	assert.ok(result.diagnostics.some(item => item.code === 'L4309' && item.message.includes('mutable value items')));
	assert.equal(result.output, undefined);
});

// @virune-rule {"id":"frontend.view-repetition","runner":"unit","file":"packages/compiler/test/view-repetition-deferred-safety.test.ts","case":"Host-deferred repetition rejects unsafe inline snapshot item transport","kind":"negative","platform":"common"}
test('Host-deferred repetition rejects unsafe inline snapshot item transport', () => {
	const result = compile(`component ListView() uses JavaScript {
	return view {
		for item in [MutableBytes.create(4)] by 1 {
			"body"
		}
	}
}
`);
	assert.ok(result.diagnostics.some(item => item.code === 'L4309' && item.message.includes('item of type MutableBytes')));
	assert.equal(result.output, undefined);
});

// @virune-rule {"id":"frontend.view-repetition","runner":"unit","file":"packages/compiler/test/view-repetition-deferred-safety.test.ts","case":"Host-deferred repetition rejects raw module callable captures in snapshot identity evaluation","kind":"negative","platform":"common"}
test('Host-deferred repetition rejects raw module callable captures in snapshot identity evaluation', () => {
	const result = compile(`fn identityFn(value: Int) -> Int {
	return value
}

component ListView() uses JavaScript {
	return view {
		for item in [1, 2] by identityFn(item) {
			span() { { item } }
		}
	}
}
`);
	assert.ok(result.diagnostics.some(item => item.code === 'L4309' && item.message.includes('identityFn of type fn(Int) -> Int')));
	assert.equal(result.output, undefined);
});

// @virune-rule {"id":"frontend.view-repetition","runner":"unit","file":"packages/compiler/test/view-repetition-deferred-safety.test.ts","case":"Nested Host-deferred repetition validates captures used by its snapshot source","kind":"negative","platform":"common"}
test('Nested Host-deferred repetition validates captures used by its snapshot source', () => {
	const result = compile(`component ListView() uses JavaScript {
	let mut nestedItems = [1, 2]
	return view {
		for outer in [1] by outer {
			for inner in nestedItems by inner {
				span() { { inner } }
			}
		}
	}
}
`);
	assert.ok(result.diagnostics.some(item => item.code === 'L4309' && item.message.includes('mutable value nestedItems')));
});

// @virune-rule {"id":"frontend.view-repetition","runner":"unit","file":"packages/compiler/test/view-repetition-deferred-safety.test.ts","case":"Host-deferred repetition accepts current External captures","kind":"positive","platform":"common"}
test('Host-deferred repetition accepts current External captures', () => {
	const result = compile(`import js { externalValue } from "./library.js"

component ListView() uses JavaScript {
	return view {
		for item in [1] by item {
			span() { { externalValue } }
		}
	}
}
`, externalProvider);
	assert.deepEqual(result.diagnostics.filter(item => item.severity === 'error'), []);
	assert.ok(result.output);
});

// @virune-rule {"id":"frontend.view-repetition","runner":"unit","file":"packages/compiler/test/view-repetition-deferred-safety.test.ts","case":"Host-deferred repetition rejects must-use External captures","kind":"negative","platform":"common"}
test('Host-deferred repetition rejects must-use External captures', () => {
	const result = compile(`import js { externalValue } from "./library.js"

component ListView() uses JavaScript {
	return view {
		for item in [1] by item {
			span() { { externalValue } }
		}
	}
}
`, externalCaptureProvider('object', true));
	assert.ok(result.diagnostics.some(item => item.code === 'L4309' && item.message.includes('externalValue')));
	assert.equal(result.output, undefined);
});

// @virune-rule {"id":"frontend.view-repetition","runner":"unit","file":"packages/compiler/test/view-repetition-deferred-safety.test.ts","case":"Host-deferred repetition rejects unresolved External captures after supported use-site projection","kind":"negative","platform":"common"}
test('Host-deferred repetition rejects unresolved External captures after supported use-site projection', () => {
	const result = compile(`import js { externalValue } from "./library.js"

component ListView() uses JavaScript {
	return view {
		for item in [1] by item {
			span() { { externalValue() } }
		}
	}
}
`, externalCaptureProvider('unknown', undefined, true));
	assert.ok(result.diagnostics.some(item => item.code === 'L4309' && item.message.includes('externalValue')));
	assert.equal(result.output, undefined);
});

// @virune-rule {"id":"frontend.view-repetition","runner":"unit","file":"packages/compiler/test/view-repetition-deferred-safety.test.ts","case":"External any remains rejected before deferred capture validation","kind":"negative","platform":"common"}
test('External any remains rejected before deferred capture validation', () => {
	const result = compile(`import js { externalValue } from "./library.js"

component ListView() uses JavaScript {
	return view {
		for item in [1] by item {
			span() { { externalValue } }
		}
	}
}
`, externalCaptureProvider('any'));
	assert.ok(codes(result).includes('L4212'));
	assert.equal(result.output, undefined);
});

// @virune-rule {"id":"frontend.view-repetition","runner":"unit","file":"packages/compiler/test/view-repetition-deferred-safety.test.ts","case":"Host-deferred repetition rejects unbound string interpolation captures","kind":"negative","platform":"common"}
test('Host-deferred repetition rejects unbound string interpolation captures', () => {
	const result = compile(`component ListView() uses JavaScript {
	let prefix = "row"
	return view {
		for item in [1] by item {
			span(label: "{prefix}")
		}
	}
}
`);
	assert.ok(result.diagnostics.some(item => item.code === 'L4309' && item.message.includes('string interpolation')));
});

// @virune-rule {"id":"frontend.view-repetition","runner":"unit","file":"packages/compiler/test/view-repetition-deferred-safety.test.ts","case":"Host-deferred repetition rejects mutable captures","kind":"negative","platform":"common"}
test('Host-deferred repetition rejects mutable captures', () => {
	const result = compile(`component ListView() uses JavaScript {
	let items = [1, 2]
	let mut prefix = "row"
	return view {
		for item in items by item {
			span() { { prefix } }
		}
	}
}
`);
	assert.ok(codes(result).includes('L4309'));
	assert.ok(result.diagnostics.some(item => item.code === 'L4309' && item.message.includes('mutable value prefix')));
});

// @virune-rule {"id":"frontend.view-repetition","runner":"unit","file":"packages/compiler/test/view-repetition-deferred-safety.test.ts","case":"Host-deferred repetition rejects lifetime-bound native captures","kind":"negative","platform":"common"}
test('Host-deferred repetition rejects lifetime-bound native captures', () => {
	const result = compile(`component ListView() uses JavaScript {
	let bytes = MutableBytes.create(4)
	return view {
		for item in [1] by item {
			span() { { Debug.format(bytes) } }
		}
	}
}
`);
	assert.ok(result.diagnostics.some(item => item.code === 'L4309' && item.message.includes('bytes of type MutableBytes')));
});

// @virune-rule {"id":"frontend.view-repetition","runner":"unit","file":"packages/compiler/test/view-repetition-deferred-safety.test.ts","case":"Host-deferred repetition rejects raw local callable captures","kind":"negative","platform":"common"}
test('Host-deferred repetition rejects raw local callable captures', () => {
	const result = compile(`component ListView() uses JavaScript {
	let identityFn = fn(value: Int) -> Int => value
	return view {
		for item in [1] by item {
			span() { { identityFn(item) } }
		}
	}
}
`);
	assert.ok(result.diagnostics.some(item => item.code === 'L4309' && item.message.includes('identityFn of type fn(Int) -> Int')));
});

// @virune-rule {"id":"frontend.view-repetition","runner":"unit","file":"packages/compiler/test/view-repetition-deferred-safety.test.ts","case":"Host-deferred repetition rejects raw module callable captures","kind":"negative","platform":"common"}
test('Host-deferred repetition rejects raw module callable captures', () => {
	const result = compile(`fn identityFn(value: Int) -> Int {
	return value
}

component ListView() uses JavaScript {
	return view {
		for item in [1] by item {
			span() { { identityFn(item) } }
		}
	}
}
`);
	assert.ok(result.diagnostics.some(item => item.code === 'L4309' && item.message.includes('identityFn of type fn(Int) -> Int')));
});

// @virune-rule {"id":"frontend.view-repetition","runner":"unit","file":"packages/compiler/test/view-repetition-deferred-safety.test.ts","case":"Structural repetition without identity keeps existing capture semantics","kind":"positive","platform":"common"}
test('Structural repetition without identity keeps existing capture semantics', () => {
	const result = compile(`component ListView() uses JavaScript {
	let items = [1, 2]
	let mut prefix = "row"
	return view {
		for item in items {
			span() { { prefix } }
		}
	}
}
`);
	assert.ok(!result.diagnostics.some(item => item.code === 'L4309' && item.message.includes('Host-deferred View repetition')));
});

// @virune-rule {"id":"frontend.view-repetition","runner":"unit","file":"packages/compiler/test/view-repetition-deferred-safety.test.ts","case":"Question-mark propagation remains rejected inside component View repetition","kind":"negative","platform":"common"}
test('Question-mark propagation remains rejected inside component View repetition', () => {
	const result = compile(`fn checked(value: Int) -> Result<Int, String> {
	return Ok(value)
}

component ListView() uses JavaScript {
	return view {
		for item in [1] by item {
			span() { { checked(item)? } }
		}
	}
}
`);
	assert.ok(codes(result).includes('L2020'));
});
