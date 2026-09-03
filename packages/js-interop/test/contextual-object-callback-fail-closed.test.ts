import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import {
	compileSource,
	type ContextualCallableResult,
	type ForeignCallResolution,
	type ForeignTypeSnapshot,
	type JsInteropProvider,
} from '@virune/compiler/experimental';
import { TypeScriptInteropProvider } from '../src/index.js';
import { fixtureRoot } from './fixture.js';

async function compileCase(
	declarations: string,
	source: string,
	providerFactory?: (provider: TypeScriptInteropProvider) => JsInteropProvider,
) {
	const root = await fixtureRoot();
	await writeFile(join(root, 'src/library.d.ts'), declarations, 'utf8');
	await writeFile(join(root, 'src/library.js'), `
export function consume(_config) {}
export function consumeAny(_config) {}
export function consumeUnknown(_config) {}
export function consumeGeneric(_config) {}
export function consumeAmbiguous(_config) {}
`, 'utf8');
	const baseProvider = new TypeScriptInteropProvider({ projectRoot: root });
	const provider = providerFactory?.(baseProvider) ?? baseProvider;
	return compileSource(
		{ id: 1, path: join(root, 'src/main.virune'), text: source },
		{ platform: 'node', jsInteropProvider: provider },
	);
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

function mutateNestedCallableParameter(
	resolution: ForeignCallResolution | undefined,
	when: (result: ContextualCallableResult) => boolean,
	mutate: (parameter: ForeignTypeSnapshot) => ForeignTypeSnapshot,
): ForeignCallResolution | undefined {
	if (resolution === undefined) return undefined;
	const objectArguments = resolution.objectArguments;
	if (objectArguments === undefined) return resolution;
	const objectArgument = objectArguments[0];
	const entry = objectArgument?.object.entries.find(item => item.property === 'onEvent');
	const callable = entry?.callable;
	const first = callable?.parameters[0];
	if (objectArgument === undefined || entry === undefined || callable === undefined || first === undefined || typeof first === 'string' || !when(callable.result)) return resolution;
	const entries = objectArgument.object.entries.map(item => item !== entry ? item : {
		...item,
		callable: {
			...callable,
			parameters: callable.parameters.map((parameter, index) => index === 0 ? mutate(first) : parameter),
		},
	});
	return {
		...resolution,
		objectArguments: objectArguments.map((item, index) => index === 0 ? {
			...item,
			object: { ...item.object, entries },
		} : item),
	};
}

function errorCodes(result: Awaited<ReturnType<typeof compileCase>>): string[] {
	return result.diagnostics.filter(item => item.severity === 'error').map(item => item.code);
}

function projectionCount(result: Awaited<ReturnType<typeof compileCase>>): number {
	return result.semantic?.interop.objectCallableProjections?.length ?? 0;
}

const baseDeclarations = `
export interface ExternalTarget {
	mark(value: string): void;
}
export interface ExternalEvent {
	readonly currentTarget: ExternalTarget;
}
`;

const nestedSource = `import js { consume } from "./library.js"

fn main() -> Unit uses JavaScript {
	discard consume({
		onEvent: fn(event) uses JavaScript => event.currentTarget.mark("seen"),
	})
	return Unit
}
`;

test('nested contextual any and unknown parameters remain fail closed', async () => {
	for (const [name, type] of [['consumeAny', 'any'], ['consumeUnknown', 'unknown']] as const) {
		const result = await compileCase(
			`export declare function ${name}(config: { onEvent?: (event: ${type}) => void }): void;`,
			`import js { ${name} } from "./library.js"

fn main() -> Unit uses JavaScript {
	discard ${name}({ onEvent: fn(event) => panic("no unsafe contextual projection") })
	return Unit
}
`,
		);
		assert.ok(errorCodes(result).includes('L4204'), `${name} must fail closed`);
		assert.equal(projectionCount(result), 0);
	}
});

test('nested unresolved and ambiguous callback contexts remain fail closed', async () => {
	const cases = [
		[
			'consumeGeneric',
			`export declare function consumeGeneric<T>(config: { onEvent?: (event: T) => void }): void;`,
		],
		[
			'consumeAmbiguous',
			`${baseDeclarations}
export interface OtherEvent { readonly other: true; }
export declare function consumeAmbiguous(config: { onEvent?: ((event: ExternalEvent) => void) | ((event: OtherEvent) => void) }): void;`,
		],
	] as const;
	for (const [name, declarations] of cases) {
		const result = await compileCase(
			declarations,
			`import js { ${name} } from "./library.js"

fn main() -> Unit uses JavaScript {
	discard ${name}({ onEvent: fn(event) => panic("no unresolved projection") })
	return Unit
}
`,
		);
		assert.ok(errorCodes(result).includes('L4204'), `${name} must fail closed`);
		assert.equal(projectionCount(result), 0);
	}
});

test('nested incompatible callback result is rejected by final whole-usage proof', async () => {
	const result = await compileCase(
		`${baseDeclarations}
export interface ExpectedResult { readonly expected: true; }
export interface WrongResult { readonly wrong: true; }
export interface ResultTarget {
	wrong(): WrongResult;
}
export interface ResultEvent { readonly currentTarget: ResultTarget; }
export declare function consume(config: { onEvent?: (event: ResultEvent) => ExpectedResult }): void;`,
		`import js { consume } from "./library.js"

fn main() -> Unit uses JavaScript {
	discard consume({ onEvent: fn(event) uses JavaScript => event.currentTarget.wrong() })
	return Unit
}
`,
	);
	assert.ok(errorCodes(result).includes('L4204'));
	assert.equal(projectionCount(result), 0);
});

test('nested provider-mismatched provisional and stale final evidence remain fail closed', async () => {
	const declarations = `${baseDeclarations}
export declare function consume(config: { onEvent?: (event: ExternalEvent) => void }): void;`;
	const cases: readonly {
		readonly name: string;
		readonly when: (result: ContextualCallableResult) => boolean;
		readonly mutate: (parameter: ForeignTypeSnapshot) => ForeignTypeSnapshot;
	}[] = [
		{
			name: 'provider-mismatched provisional evidence',
			when: result => result.kind === 'deferred',
			mutate: parameter => ({ ...parameter, ref: { ...parameter.ref, providerId: `${parameter.ref.providerId}:foreign` } }),
		},
		{
			name: 'stale final evidence',
			when: result => result.kind !== 'deferred',
			mutate: parameter => ({ ...parameter, ref: { ...parameter.ref, generation: parameter.ref.generation + 1 } }),
		},
	];
	for (const { name, when, mutate } of cases) {
		const result = await compileCase(
			declarations,
			nestedSource,
			provider => usageOverrideProvider(provider, resolution => mutateNestedCallableParameter(resolution, when, mutate)),
		);
		assert.ok(errorCodes(result).includes('L4204'), `${name} must fail closed`);
		assert.equal(projectionCount(result), 0, `${name} must not commit object callable projection evidence`);
	}
});

test('cross-workspace nested contextual evidence remains fail closed when opaque refs collide', async () => {
	const declarations = `${baseDeclarations}
export declare function consume(config: { onEvent?: (event: ExternalEvent) => void }): void;`;
	const foreignRoot = await fixtureRoot();
	await writeFile(join(foreignRoot, 'src/library.d.ts'), declarations, 'utf8');
	await writeFile(join(foreignRoot, 'src/library.js'), 'export function consume(_config) {}\n', 'utf8');
	const foreignProvider = new TypeScriptInteropProvider({ projectRoot: foreignRoot });
	const foreignConsume = foreignProvider.resolveImport({
		containingFile: join(foreignRoot, 'src/main.virune'),
		moduleSpecifier: './library.js',
		kind: 'named',
		importedName: 'consume',
		platform: 'node',
	}).type;
	assert.ok(foreignConsume);
	const foreignResolution = (foreignProvider as JsInteropProvider).resolveCallUsage?.(foreignConsume.ref, {
		target: { kind: 'value' },
		arguments: [{
			kind: 'contextual-object',
			object: { entries: [{ property: 'onEvent', value: { kind: 'contextual-callable', parameterCount: 1, async: false } }] },
		}],
	});
	const foreignParameter = foreignResolution?.objectArguments?.[0]?.object.entries[0]?.callable?.parameters[0];
	assert.ok(foreignParameter !== undefined && typeof foreignParameter !== 'string');
	let collided = false;
	const result = await compileCase(
		declarations,
		nestedSource,
		provider => usageOverrideProvider(provider, resolution => mutateNestedCallableParameter(
			resolution,
			result => result.kind === 'deferred',
			localParameter => {
				collided = localParameter.ref.providerId === foreignParameter.ref.providerId
					&& localParameter.ref.generation === foreignParameter.ref.generation
					&& localParameter.ref.id === foreignParameter.ref.id;
				return collided ? foreignParameter : localParameter;
			},
		)),
	);
	assert.equal(collided, true, 'fixture must reproduce equal opaque ref fields across provider workspaces');
	assert.ok(errorCodes(result).includes('L4204'));
	assert.equal(projectionCount(result), 0);
});

test('mixed unsafe native values do not become External through nested callback inference', async () => {
	const result = await compileCase(
		`${baseDeclarations}
export declare function consume(config: { onEvent?: (event: ExternalEvent) => void; payload?: unknown }): void;`,
		`import js { consume } from "./library.js"

record Payload {
	value: String
}

fn main() -> Unit uses JavaScript {
	discard consume({
		onEvent: fn(event) uses JavaScript => event.currentTarget.mark("seen"),
		payload: Payload { value: "native" },
	})
	return Unit
}
`,
	);
	assert.ok(errorCodes(result).includes('L4206'));
	assert.equal(projectionCount(result), 0);
});
