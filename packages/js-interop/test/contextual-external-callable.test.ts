import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { compileSource } from '@virune/compiler/experimental';
import { TypeScriptInteropProvider } from '../src/index.js';
import { fixtureRoot } from './fixture.js';

async function compileCase(declarations: string, source: string) {
	const root = await fixtureRoot();
	await writeFile(join(root, 'src/library.d.ts'), declarations, 'utf8');
	await writeFile(join(root, 'src/library.js'), 'export function route(_path, _handler) {}\nexport function routeAny(_handler) {}\nexport function routeUnknown(_handler) {}\n', 'utf8');
	const provider = new TypeScriptInteropProvider({ projectRoot: root });
	return compileSource({ id: 1, path: join(root, 'src/main.virune'), text: source }, { platform: 'node', jsInteropProvider: provider });
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
