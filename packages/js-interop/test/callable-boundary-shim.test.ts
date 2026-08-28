import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import {
	compileSource,
	externalOperationSequence,
	type ForeignCallResolution,
	type JsInteropProvider,
} from '@virune/compiler/experimental';
import { TypeScriptInteropProvider } from '../src/index.js';
import { fixtureRoot } from './fixture.js';

async function compileWithDeclarations(declarations: string, sourceText: string) {
	const root = await fixtureRoot();
	await writeFile(join(root, 'src/library.d.ts'), declarations, 'utf8');
	const provider = new TypeScriptInteropProvider({ projectRoot: root });
	return compileSource({ id: 1, path: join(root, 'src/main.virune'), text: sourceText }, { platform: 'node', jsInteropProvider: provider });
}

function usageOverrideProvider(
	provider: TypeScriptInteropProvider,
	override: (resolution: ForeignCallResolution | undefined) => ForeignCallResolution | undefined,
): JsInteropProvider {
	const wholeUsageProvider = provider as JsInteropProvider;
	return {
		id: provider.id,
		version: provider.version,
		generation: provider.generation,
		resolveImport: request => provider.resolveImport(request),
		getProperty: (reference, name) => provider.getProperty(reference, name),
		resolveCallUsage: (reference, usage) => override(wholeUsageProvider.resolveCallUsage?.(reference, usage)),
		resolveCall: (reference, argumentsList) => provider.resolveCall(reference, argumentsList),
		resolveConstruct: (reference, argumentsList) => provider.resolveConstruct(reference, argumentsList),
		getAwaitedType: reference => provider.getAwaitedType(reference),
		display: reference => provider.display(reference),
	};
}

test('emits a generated sync callable shim using the existing FFI boundary and external root context', async () => {
	const result = await compileWithDeclarations(
		'export declare function apply(callback: (value: number) => number): number;\n',
		`import js { apply } from "./library.js"\n\nfn double(value: Float) -> Float {\n\treturn value + value\n}\n\nfn main() -> Unit uses JavaScript {\n\tdiscard apply(double)\n\treturn Unit\n}\n`,
	);
	assert.deepEqual(result.diagnostics.filter(item => item.severity === 'error'), []);
	const code = result.output?.code ?? '';
	assert.match(code, /const \$viruneCallableShimCacheKey = '\$virune\.callable-shim\.cache\/v1'/u);
	assert.match(code, /\$viruneCallableShimObject\.defineProperty\(\$fn, \$viruneCallableShimCacheKey, \{ value: \$cache, enumerable: false, configurable: false, writable: false \}\)/u);
	assert.match(code, /\$viruneProjectCallable\(double,/u);
	assert.match(code, /validateFfiValue\(\$raw0, \{ kind: 'float' \}, "\$\[0\]"\)/u);
	assert.match(code, /\$fn\(validateFfiValue\(\$raw0, \{ kind: 'float' \}, "\$\[0\]"\), rootTaskContext\(\)\)/u);
	assert.match(code, /encodeFfiValue\(/u);
	const projection = result.semantic?.interop.callableProjections?.[0];
	assert.ok(projection);
	assert.equal(projection.argumentIndex, 0);
	assert.deepEqual(projection.descriptor, {
		version: 'virune-callable-shim/v1',
		parameters: ['Float'],
		result: 'Float',
		async: false,
		effects: [],
		contextMode: 'root-argument',
	});
	assert.doesNotMatch(JSON.stringify(projection.descriptor), /provider|typescript|library|package/iu);
	assert.ok(result.semantic);
	const callOperation = externalOperationSequence(result.semantic).find(operation => operation.kind === 'call');
	assert.ok(callOperation?.kind === 'call');
	assert.deepEqual(callOperation.decision, {
		status: 'resolved',
		mechanism: 'callable-shim',
		authoring: 'generated',
		claims: ['type-boundary-safe'],
		obligations: [],
	});
	const stableProjection = callOperation.callableProjections?.[0];
	assert.ok(stableProjection);
	assert.equal(stableProjection.argumentIndex, 0);
	assert.equal(Number.isSafeInteger(stableProjection.beforeOperationIndex), true);
	assert.deepEqual(stableProjection.descriptor, projection.descriptor);
});

test('emits async callable projection without weakening rejection semantics', async () => {
	const result = await compileWithDeclarations(
		'export declare function applyAsync(callback: (value: string) => Promise<string>): void;\n',
		`import js { applyAsync } from "./library.js"\n\nasync fn echo(value: String) -> String {\n\treturn value\n}\n\nfn main() -> Unit uses JavaScript {\n\tdiscard applyAsync(echo)\n\treturn Unit\n}\n`,
	);
	assert.deepEqual(result.diagnostics.filter(item => item.severity === 'error'), []);
	const code = result.output?.code ?? '';
	assert.match(code, /async \(\$raw0\) => \{ return encodeFfiValue\(await \$fn\(/u);
	assert.equal(result.semantic?.interop.callableProjections?.[0]?.descriptor.async, true);
});

test('accepts TypeScript void only for a Virune Unit callback', async () => {
	const accepted = await compileWithDeclarations(
		'export declare function consume(callback: () => void): void;\n',
		`import js { consume } from "./library.js"\n\nfn done() -> Unit {\n\treturn Unit\n}\n\nfn main() -> Unit uses JavaScript {\n\tdiscard consume(done)\n\treturn Unit\n}\n`,
	);
	assert.deepEqual(accepted.diagnostics.filter(item => item.severity === 'error'), []);
	assert.match(accepted.output?.code ?? '', /\{ kind: 'undefined' \}/u);

	const rejected = await compileWithDeclarations(
		'export declare function consume(callback: () => void): void;\n',
		`import js { consume } from "./library.js"\n\nfn value() -> String {\n\treturn "not discarded"\n}\n\nfn main() -> Unit uses JavaScript {\n\tdiscard consume(value)\n\treturn Unit\n}\n`,
	);
	assert.ok(rejected.diagnostics.some(item => item.code === 'L4204'));
});

test('fails closed when a contextual callback may omit a required Virune argument', async () => {
	const declarations = 'export declare function consume(callback: (value?: number) => number): void;\n';
	const source = `import js { consume } from "./library.js"\n\nfn callback(value: Float) -> Float {\n\treturn value\n}\n\nfn main() -> Unit uses JavaScript {\n\tdiscard consume(callback)\n\treturn Unit\n}\n`;
	const result = await compileWithDeclarations(declarations, source);
	assert.ok(result.diagnostics.some(item => item.code === 'L4204'));

	const root = await fixtureRoot();
	await writeFile(join(root, 'src/library.d.ts'), declarations, 'utf8');
	const laxNullProvider = new TypeScriptInteropProvider({ projectRoot: root, compilerOptions: { strictNullChecks: false, exactOptionalPropertyTypes: false } });
	const laxNullResult = compileSource({ id: 1, path: join(root, 'src/main.virune'), text: source }, { platform: 'node', jsInteropProvider: laxNullProvider });
	assert.ok(laxNullResult.diagnostics.some(item => item.code === 'L4204'));
});

test('fails closed for any, unknown, generic, construct-only, and required-property callback targets', async () => {
	const cases = [
		['any', 'export declare function consume(callback: any): void;\n'],
		['unknown', 'export declare function consume(callback: unknown): void;\n'],
		['generic', 'export declare function consume(callback: <T>(value: T) => T): void;\n'],
		['construct-only', 'export declare function consume(callback: new (value: number) => object): void;\n'],
		['required-property', 'interface Tagged { (value: number): number; readonly tag: string }\nexport declare function consume(callback: Tagged): void;\n'],
	] as const;
	for (const [name, declarations] of cases) {
		const result = await compileWithDeclarations(
			declarations,
			`import js { consume } from "./library.js"\n\nfn callback(value: Float) -> Float {\n\treturn value\n}\n\nfn main() -> Unit uses JavaScript {\n\tdiscard consume(callback)\n\treturn Unit\n}\n`,
		);
		assert.ok(result.diagnostics.some(item => item.code === 'L4204'), `${name} must fail closed: ${result.diagnostics.map(item => item.code).join(', ')}`);
	}
});

test('fails closed on partial, duplicate, out-of-order, and malformed callback evidence', async () => {
	const root = await fixtureRoot();
	await writeFile(join(root, 'src/library.d.ts'), 'export declare function consume(first: (value: number) => number, second: (value: string) => string): void;\n', 'utf8');
	const source = `import js { consume } from "./library.js"\n\nfn first(value: Float) -> Float {\n\treturn value\n}\n\nfn second(value: String) -> String {\n\treturn value\n}\n\nfn main() -> Unit uses JavaScript {\n\tdiscard consume(first, second)\n\treturn Unit\n}\n`;
	for (const [name, mutate] of [
		['partial', (items: NonNullable<ForeignCallResolution['callableArguments']>) => items.slice(0, 1)],
		['duplicate', (items: NonNullable<ForeignCallResolution['callableArguments']>) => [items[0]!, items[0]!]],
		['out-of-order', (items: NonNullable<ForeignCallResolution['callableArguments']>) => [...items].reverse()],
		['malformed', (items: NonNullable<ForeignCallResolution['callableArguments']>) => [
			{ ...items[0]!, target: { ...items[0]!.target, extra: true } },
			items[1]!,
		] as unknown as NonNullable<ForeignCallResolution['callableArguments']>],
	] as const) {
		const base = new TypeScriptInteropProvider({ projectRoot: root });
		const provider = usageOverrideProvider(base, resolution => resolution === undefined ? undefined : {
			...resolution,
			callableArguments: mutate(resolution.callableArguments ?? []),
		});
		const result = compileSource({ id: 1, path: join(root, 'src/main.virune'), text: source }, { platform: 'node', jsInteropProvider: provider });
		assert.ok(result.diagnostics.some(item => item.code === 'L4204'), `${name} callback evidence must fail closed`);
	}
});

test('fails closed when callback usage crosses provider generations', async () => {
	const root = await fixtureRoot();
	await writeFile(join(root, 'src/library.d.ts'), 'export declare function consume(callback: (value: number) => number): void;\n', 'utf8');
	const importingProvider = new TypeScriptInteropProvider({ projectRoot: root, generation: 1 });
	const resolvingProvider = new TypeScriptInteropProvider({ projectRoot: root, generation: 2 });
	const resolvingWholeUsageProvider = resolvingProvider as JsInteropProvider;
	const hybrid: JsInteropProvider = {
		id: importingProvider.id,
		version: importingProvider.version,
		generation: importingProvider.generation,
		resolveImport: request => importingProvider.resolveImport(request),
		getProperty: (reference, name) => importingProvider.getProperty(reference, name),
		resolveCallUsage: (reference, usage) => resolvingWholeUsageProvider.resolveCallUsage?.(reference, usage),
		resolveCall: (reference, argumentsList) => resolvingProvider.resolveCall(reference, argumentsList),
		resolveConstruct: (reference, argumentsList) => importingProvider.resolveConstruct(reference, argumentsList),
		getAwaitedType: reference => importingProvider.getAwaitedType(reference),
		display: reference => importingProvider.display(reference),
	};
	const result = compileSource({
		id: 1,
		path: join(root, 'src/main.virune'),
		text: `import js { consume } from "./library.js"\n\nfn callback(value: Float) -> Float {\n\treturn value\n}\n\nfn main() -> Unit uses JavaScript {\n\tdiscard consume(callback)\n\treturn Unit\n}\n`,
	}, { platform: 'node', jsInteropProvider: hybrid });
	assert.ok(result.diagnostics.some(item => item.code === 'L4204'));
});

test('rejects open effects and propagates concrete callback effects', async () => {
	const open = await compileWithDeclarations(
		'export declare function consume(callback: (value: string) => string): void;\n',
		`import js { consume } from "./library.js"\n\nfn callback(value: String) -> String uses * {\n\treturn value\n}\n\nfn main() -> Unit uses JavaScript {\n\tdiscard consume(callback)\n\treturn Unit\n}\n`,
	);
	assert.ok(open.diagnostics.some(item => item.code === 'L4204' || item.code === 'L2113'));

	const missing = await compileWithDeclarations(
		'export declare function consume(callback: (value: string) => string): void;\n',
		`import js { consume } from "./library.js"\n\nfn callback(value: String) -> String uses Console {\n\tConsole.print(value)\n\treturn value\n}\n\nfn main() -> Unit uses JavaScript {\n\tdiscard consume(callback)\n\treturn Unit\n}\n`,
	);
	assert.ok(missing.diagnostics.some(item => item.code === 'L2076' && item.message.includes('Effect Console')));

	const concrete = await compileWithDeclarations(
		'export declare function consume(callback: (value: string) => string): void;\n',
		`import js { consume } from "./library.js"\n\nfn callback(value: String) -> String uses Console {\n\tConsole.print(value)\n\treturn value\n}\n\nfn main() -> Unit uses JavaScript, Console {\n\tdiscard consume(callback)\n\treturn Unit\n}\n`,
	);
	assert.deepEqual(concrete.diagnostics.filter(item => item.severity === 'error'), []);
	assert.deepEqual(concrete.semantic?.interop.callableProjections?.[0]?.descriptor.effects, ['Console']);
});

test('keeps projection in argument evaluation order and emits deterministic descriptor keys', async () => {
	const declarations = 'export declare function prefix(): string;\nexport declare function combine(prefix: string, callback: (value: number) => number, suffix: string): void;\n';
	const source = `import js { prefix, combine } from "./library.js"\n\nfn callback(value: Float) -> Float {\n\treturn value\n}\n\nfn main() -> Unit uses JavaScript {\n\tdiscard combine(prefix(), callback, "after")\n\treturn Unit\n}\n`;
	const first = await compileWithDeclarations(declarations, source);
	const second = await compileWithDeclarations(declarations, source);
	assert.deepEqual(first.diagnostics.filter(item => item.severity === 'error'), []);
	assert.deepEqual(second.diagnostics.filter(item => item.severity === 'error'), []);
	const firstCode = first.output?.code ?? '';
	const secondCode = second.output?.code ?? '';
	assert.equal(firstCode, secondCode);
	assert.match(firstCode, /combine\(prefix\(\), \$viruneProjectCallable\(callback,[\s\S]*?\), "after"\)/u);
	const projection = first.semantic?.interop.callableProjections?.[0];
	assert.ok(projection);
	assert.equal(projection.argumentIndex, 1);
	const priorExternalCallIndex = first.semantic?.interop.usageIR.findIndex(usage => usage.kind === 'call' && usage.nodeId !== projection.callNodeId) ?? -1;
	assert.ok(priorExternalCallIndex >= 0);
	assert.ok(projection.beforeUsageIndex > priorExternalCallIndex);
	assert.ok(first.semantic);
	const operations = externalOperationSequence(first.semantic);
	const outerCallIndex = operations.findIndex(operation => operation.kind === 'call' && operation.nodeId === projection.callNodeId);
	assert.ok(outerCallIndex >= 0);
	const outerCall = operations[outerCallIndex];
	assert.ok(outerCall?.kind === 'call');
	assert.equal(outerCall.callableProjections?.[0]?.beforeOperationIndex, outerCallIndex);
});
