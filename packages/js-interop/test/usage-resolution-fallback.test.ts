import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';
import {
	compileSource,
	type ForeignCallResolution,
	type ForeignTypeRef,
	type ForeignTypeSnapshot,
	type InteropArgumentType,
	type InteropCallUsage,
	type JsImportRequest,
	type JsImportResolution,
	type JsInteropProvider,
} from '@virune/compiler/experimental';
import { fixtureRoot } from './fixture.js';

const ref: ForeignTypeRef = { providerId: 'fallback-sentinel', generation: 1, id: 'callable' };
const resultRef: ForeignTypeRef = { providerId: 'fallback-sentinel', generation: 1, id: 'result' };
const callable: ForeignTypeSnapshot = { ref, display: '(value: string) => void', category: 'function' };
const result: ForeignTypeSnapshot = { ref: resultRef, display: 'void', category: 'primitive', primitive: 'void' };
const legacyResolution: ForeignCallResolution = {
	result,
	parameterCount: 1,
	optionalParameterCount: 0,
	rest: false,
	mayReject: false,
	receiverMode: 'none',
};

class FallbackSentinelProvider implements JsInteropProvider {
	readonly id = 'fallback-sentinel';
	readonly version = '1';
	readonly generation = 1;
	legacyCalls = 0;
	wholeCalls = 0;

	resolveImport(request: JsImportRequest): JsImportResolution {
		return {
			type: callable,
			runtime: { kind: 'named', importedName: request.importedName ?? 'fn' },
			witness: {
				moduleSpecifier: request.moduleSpecifier,
				conditions: ['types', 'import', 'node'],
				platform: request.platform,
				providerVersion: this.version,
			},
		};
	}

	getProperty(): undefined { return undefined; }

	resolveCallUsage(_type: ForeignTypeRef, _usage: InteropCallUsage): undefined {
		this.wholeCalls++;
		return undefined;
	}

	resolveCall(_type: ForeignTypeRef, _argumentsList: readonly InteropArgumentType[]): ForeignCallResolution {
		this.legacyCalls++;
		return legacyResolution;
	}

	resolveConstruct(): undefined { return undefined; }
	getAwaitedType(): undefined { return undefined; }
	display(): string { return callable.display; }
}

test('compiler never falls back to legacy resolveCall after whole-usage rejection', async () => {
	const root = await fixtureRoot();
	const provider = new FallbackSentinelProvider();
	const compiled = compileSource({
		id: 1,
		path: join(root, 'src/no-fallback.virune'),
		text: `import js { fn } from "./library.js"\n\nfn use() -> Unit uses JavaScript {\n\tdiscard fn("value")\n}\n`,
	}, { platform: 'node', jsInteropProvider: provider });
	assert.deepEqual(compiled.diagnostics.filter(item => item.severity === 'error').map(item => item.code), ['L4204']);
	assert.equal(provider.wholeCalls, 1);
	assert.equal(provider.legacyCalls, 0);
});
