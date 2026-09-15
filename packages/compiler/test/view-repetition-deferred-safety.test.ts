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

function compile(text: string) {
	return compileSource(source(text), { jsInteropProvider: provider });
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
