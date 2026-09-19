import assert from 'node:assert/strict';
import test from 'node:test';
import { compileSource } from '../src/compiler.js';
import type { JsInteropProvider } from '../src/interop/types.js';

const source = (text: string) => ({ id: 1, path: 'view-repetition-identity-emission.virune', text });
const provider: JsInteropProvider = {
	id: 'view-repetition-identity-emission-test',
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

function emitted(text: string): string {
	const result = compileSource(source(text), { jsInteropProvider: provider });
	assert.deepEqual(result.diagnostics.filter(item => item.severity === 'error'), []);
	assert.ok(result.output);
	return result.output.code;
}

// @virune-rule {"id":"frontend.view-repetition","runner":"unit","file":"packages/compiler/test/view-repetition-identity-emission.test.ts","case":"View repetition emission type-tags checked identities and guards each iteration body against duplicates","kind":"positive","platform":"common"}
test('View repetition emission type-tags checked identities and guards each iteration body against duplicates', () => {
	for (const [items, tag] of [['[1, 2]', 'i:'], ['["a", "b"]', 's:']] as const) {
		const code = emitted(`component ListView() uses JavaScript {
	let items = ${items}
	return view {
		for item in items by item {
			"body"
		}
	}
}
`);
		assert.match(code, /const \$viewIdentitySeen\d+ = new Set\(\);/u);
		assert.ok(code.includes(`"${tag}" + (item)`), tag);
		const duplicateGuard = code.indexOf('.has($viewIdentity');
		const body = code.indexOf('.push("body")');
		assert.ok(duplicateGuard >= 0, tag);
		assert.ok(body > duplicateGuard, tag);
		assert.ok(code.includes("throw new Error('Duplicate View repetition identity')"), tag);
	}
});

// @virune-rule {"id":"frontend.view-repetition","runner":"unit","file":"packages/compiler/test/view-repetition-identity-emission.test.ts","case":"View repetition identity pipelines reject raw module callables at the deferred Host boundary","kind":"negative","platform":"common"}
test('View repetition identity pipelines reject raw module callables at the deferred Host boundary', () => {
	const result = compileSource(source(`fn identity(value: Int) -> Int {
	return value
}

component ListView() uses JavaScript {
	let items = [1, 2]
	return view {
		for item, index in items by index |> identity {
			"body"
		}
	}
}
`), { jsInteropProvider: provider });
	assert.ok(result.diagnostics.some(item => item.code === 'L4309' && item.message.includes('identity of type fn(Int) -> Int')));
	assert.equal(result.output, undefined);
});

test('View repetition without identity preserves the existing lowering path', () => {
	const code = emitted(`component ListView() uses JavaScript {
	let items = [1, 2]
	return view {
		for item in items {
			"body"
		}
	}
}
`);
	assert.ok(!code.includes('$viewIdentity'));
	assert.match(code, /for \(let \$viewIndex\d+ = 0; \$viewIndex\d+ < \$viewLength\d+; \$viewIndex\d+\+\+\) \{/u);
	assert.ok(code.includes('.push("body")'));
});
