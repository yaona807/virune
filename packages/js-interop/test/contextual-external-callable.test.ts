import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import {
	compileSource,
	type ForeignCallResolution,
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
	await writeFile(join(root, 'src/library.js'), 'export function route(_path, _handler) {}\nexport function routeAny(_handler) {}\nexport function routeUnknown(_handler) {}\n', 'utf8');
	const baseProvider = new TypeScriptInteropProvider({ projectRoot: root });
	const provider = providerFactory?.(baseProvider) ?? baseProvider;
	return compileSource({ id: 1, path: join(root, 'src/main.virune'), text: source }, { platform: 'node', jsInteropProvider: provider });
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

function errors(result: Awaited<ReturnType<typeof compileCase>>) {
	return result.diagnostics.filter(item => item.severity === 'error');
}

const declarations = `
export interface ExternalRequest {
  param(name: string): string;
  readonly path: string;
}
export interface ExternalResponse {
  readonly status: number;
}
export interface WrongResponse {
  readonly wrong: true;
}
export interface ExternalContext {
  readonly req: ExternalRequest;
  text(value: string): ExternalResponse;
  wrong(): WrongResponse;
}
export declare function route(path: string, handler: (context: ExternalContext) => Promise<ExternalResponse>): void;
          export declare function routeFirst(handler: (context: ExternalContext) => Promise<ExternalResponse>, path: string): void;
export declare function routeAny(handler: (context: any) => Promise<ExternalResponse>): void;
export declare function routeUnknown(handler: (context: unknown) => Promise<ExternalResponse>): void;
`;

test('contextual async callback keeps concrete parameter and result External through generated shim', async () => {
	const result = await compileCase(
		declarations,
		`import js { route } from "./library.js"\n\nfn main() -> Unit uses JavaScript {\n\tdiscard route("/jobs/:id", async fn(context) uses JavaScript => context.text(context.req.param("id")))\n\treturn Unit\n}\n`,
	);
	assert.deepEqual(errors(result), []);
	const projection = result.semantic?.interop.callableProjections?.[0];
	assert.ok(projection);
	assert.equal(projection.descriptor.version, 'virune-callable-shim/v2');
	assert.deepEqual(projection.descriptor.parameters, ['External']);
	assert.equal(projection.descriptor.result, 'External');
	assert.equal(projection.descriptor.async, true);
	const code = result.output?.code ?? '';
	assert.match(code, /\$viruneProjectCallable\(/u);
	assert.match(code, /\$fn\(\$raw0, rootTaskContext\(\)\)/u);
	assert.doesNotMatch(code, /validateFfiValue\(\$raw0/u);
});

test('contextual callback returning an unrelated External value remains rejected by the final TypeScript usage proof', async () => {
	const result = await compileCase(
		declarations,
		`import js { route } from "./library.js"\n\nfn main() -> Unit uses JavaScript {\n\tdiscard route("/wrong", async fn(context) uses JavaScript => context.wrong())\n\treturn Unit\n}\n`,
	);
	assert.ok(result.diagnostics.some(item => item.code === 'L4204'));
	assert.equal(result.semantic?.interop.callableProjections?.length ?? 0, 0);
});

test('consumed contextual any remains fail closed', async () => {
	const result = await compileCase(
		declarations,
		`import js { routeAny } from "./library.js"\n\nfn main() -> Unit uses JavaScript {\n\tdiscard routeAny(async fn(context) => panic("no any projection"))\n\treturn Unit\n}\n`,
	);
	assert.ok(result.diagnostics.some(item => item.code === 'L4204'));
	assert.equal(result.semantic?.interop.callableProjections?.length ?? 0, 0);
});

test('consumed contextual unknown remains fail closed', async () => {
	const result = await compileCase(
		declarations,
		`import js { routeUnknown } from "./library.js"\n\nfn main() -> Unit uses JavaScript {\n\tdiscard routeUnknown(async fn(context) => panic("no unknown projection"))\n\treturn Unit\n}\n`,
	);
	assert.ok(result.diagnostics.some(item => item.code === 'L4204'));
	assert.equal(result.semantic?.interop.callableProjections?.length ?? 0, 0);
});

test('provider-mismatched provisional and stale final External callback evidence remain fail closed', async () => {
	const source = `import js { route } from "./library.js"\n\nfn main() -> Unit uses JavaScript {\n\tdiscard route("/jobs/:id", async fn(context) uses JavaScript => context.text("ok"))\n\treturn Unit\n}\n`;
	const cases: readonly {
		readonly name: string;
		readonly override: (resolution: ForeignCallResolution | undefined) => ForeignCallResolution | undefined;
	}[] = [
		{
			name: 'provider-mismatched provisional evidence',
			override: resolution => {
				if (resolution === undefined) return undefined;
				const contextual = resolution.contextualCallableArguments;
				const first = contextual?.[0]?.target.parameters[0];
				if (contextual === undefined || contextual.length === 0 || first === undefined || typeof first === 'string') return resolution;
				return {
					...resolution,
					contextualCallableArguments: contextual.map((item, itemIndex) => itemIndex === 0 ? {
						...item,
						target: {
							...item.target,
							parameters: item.target.parameters.map((parameter, parameterIndex) => parameterIndex === 0 ? {
								...first,
								ref: { ...first.ref, providerId: `${first.ref.providerId}:foreign` },
							} : parameter),
						},
					} : item),
				};
			},
		},
		{
			name: 'stale final evidence',
			override: resolution => {
				if (resolution === undefined) return undefined;
				if (resolution.contextualCallableArguments !== undefined && resolution.contextualCallableArguments.length !== 0) return resolution;
				const callable = resolution.callableArguments;
				const first = callable?.[0]?.target.parameters[0];
				if (callable === undefined || callable.length === 0 || first === undefined || typeof first === 'string') return resolution;
				return {
					...resolution,
					callableArguments: callable.map((item, itemIndex) => itemIndex === 0 ? {
						...item,
						target: {
							...item.target,
							parameters: item.target.parameters.map((parameter, parameterIndex) => parameterIndex === 0 ? {
								...first,
								ref: { ...first.ref, generation: first.ref.generation + 1 },
							} : parameter),
						},
					} : item),
				};
			},
		},
	];
	for (const { name, override } of cases) {
		const result = await compileCase(declarations, source, provider => usageOverrideProvider(provider, override));
		assert.ok(result.diagnostics.some(item => item.code === 'L4204'), `${name} must fail closed`);
		assert.equal(result.semantic?.interop.callableProjections?.length ?? 0, 0, `${name} must not commit a callable projection`);
	}
});

test('cross-workspace contextual External evidence remains fail closed when opaque ref fields collide', async () => {
	const foreignRoot = await fixtureRoot();
	await writeFile(join(foreignRoot, 'src/library.d.ts'), declarations, 'utf8');
	await writeFile(join(foreignRoot, 'src/library.js'), 'export function route(_path, _handler) {}\n', 'utf8');
	const foreignProvider = new TypeScriptInteropProvider({ projectRoot: foreignRoot });
	const foreignRoute = foreignProvider.resolveImport({
		containingFile: join(foreignRoot, 'src/main.virune'),
		moduleSpecifier: './library.js',
		kind: 'named',
		importedName: 'route',
		platform: 'node',
	}).type;
	assert.ok(foreignRoute);
	const foreignResolution = (foreignProvider as JsInteropProvider).resolveCallUsage?.(foreignRoute.ref, {
		target: { kind: 'value' },
		arguments: [
			{ kind: 'native-primitive', primitive: 'String' },
			{ kind: 'contextual-callable', parameterCount: 1, async: true },
		],
	});
	const foreignParameter = foreignResolution?.contextualCallableArguments?.[0]?.target.parameters[0];
	assert.ok(foreignParameter !== undefined && typeof foreignParameter !== 'string');
	let collided = false;
	const result = await compileCase(
		declarations,
		`import js { route } from "./library.js"\n\nfn main() -> Unit uses JavaScript {\n\tdiscard route("/jobs/:id", async fn(context) uses JavaScript => context.text("ok"))\n\treturn Unit\n}\n`,
		provider => usageOverrideProvider(provider, resolution => {
			if (resolution === undefined) return undefined;
			const contextual = resolution.contextualCallableArguments;
			const localParameter = contextual?.[0]?.target.parameters[0];
			if (contextual === undefined || contextual.length === 0 || localParameter === undefined || typeof localParameter === 'string') return resolution;
			collided = localParameter.ref.providerId === foreignParameter.ref.providerId
				&& localParameter.ref.generation === foreignParameter.ref.generation
				&& localParameter.ref.id === foreignParameter.ref.id;
			if (!collided) return resolution;
			return {
				...resolution,
				contextualCallableArguments: contextual.map((item, itemIndex) => itemIndex === 0 ? {
					...item,
					target: {
						...item.target,
						parameters: item.target.parameters.map((parameter, parameterIndex) => parameterIndex === 0 ? foreignParameter : parameter),
					},
				} : item),
			};
		}),
	);
	assert.equal(collided, true, 'fixture must reproduce equal opaque ref fields across provider workspaces');
	assert.ok(result.diagnostics.some(item => item.code === 'L4204'));
	assert.equal(result.semantic?.interop.callableProjections?.length ?? 0, 0);
});

test('native aggregate and raw callable callback results cannot masquerade as External', async () => {
	const cases = [
		[
			'native aggregate',
			`import js { route } from "./library.js"\n\nrecord Payload {\n\tvalue: String\n}\n\nfn main() -> Unit uses JavaScript {\n\tdiscard route("/native", async fn(context) => Payload { value: "native" })\n\treturn Unit\n}\n`,
		],
		[
			'raw native callable',
			`import js { route } from "./library.js"\n\nfn helper() -> String {\n\treturn "native"\n}\n\nfn main() -> Unit uses JavaScript {\n\tdiscard route("/callable", async fn(context) => helper)\n\treturn Unit\n}\n`,
		],
	] as const;
	for (const [name, source] of cases) {
		const result = await compileCase(declarations, source);
		assert.ok(result.diagnostics.some(item => item.code === 'L4206'), `${name} must be rejected before projection`);
		assert.equal(result.semantic?.interop.callableProjections?.length ?? 0, 0, `${name} must not commit a callable projection`);
	}
});

test('Never callback result is projected without allowing a normal return value to escape', async () => {
	const result = await compileCase(
		declarations,
		`import js { route } from "./library.js"\n\nfn main() -> Unit uses JavaScript {\n\tdiscard route("/fail", async fn(context) => panic("intentional"))\n\treturn Unit\n}\n`,
	);
	assert.deepEqual(errors(result), []);
	const projection = result.semantic?.interop.callableProjections?.[0];
	assert.ok(projection);
	assert.deepEqual(projection.descriptor.parameters, ['External']);
	assert.equal(projection.descriptor.result, 'Never');
	const code = result.output?.code ?? '';
	assert.match(code, /Virune Never callback returned unexpectedly/u);
	assert.match(code, /\$viruneExternalizeInteropError/u);
});


test('non-last unannotated callback remains fail closed instead of reordering later argument evaluation', async () => {
	const result = await compileCase(
		declarations,
		`import js { routeFirst } from "./library.js"\n\nfn main() -> Unit uses JavaScript {\n\tdiscard routeFirst(async fn(context) uses JavaScript => context.text("ok"), "/ordered")\n\treturn Unit\n}\n`,
	);
	assert.notEqual(errors(result).length, 0);
	assert.equal(result.semantic?.interop.callableProjections?.length ?? 0, 0);
});
