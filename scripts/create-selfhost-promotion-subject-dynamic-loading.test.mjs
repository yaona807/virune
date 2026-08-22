import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { hashRelativeModuleClosure } from './create-selfhost-promotion-subject.mjs';
import { hashRequiredSelfhostHostContract } from './selfhost-promotion-host-contract.mjs';

async function fixture() {
	const root = await mkdtemp(join(tmpdir(), 'virune-bootstrap-policy-dynamic-'));
	return { root, async cleanup() { await rm(root, { recursive: true, force: true }); } };
}

test('bootstrap policy closure rejects non-analyzable dynamic import and require targets', async () => {
	const f = await fixture();
	try {
		await mkdir(join(f.root, 'selfhost'), { recursive: true });
		await writeFile(join(f.root, 'selfhost', 'hidden.js'), 'export const hidden = true;\n', 'utf8');
		for (const source of [
			"const target = './hidden.js';\nexport async function load() { return import(target); }\n",
			"const target = './hidden.js';\nexport function load() { return require(target); }\n",
		]) {
			await writeFile(join(f.root, 'selfhost', 'root.js'), source, 'utf8');
			await assert.rejects(
				() => hashRelativeModuleClosure({ baseDirectory: f.root, roots: ['selfhost/root.js'], claim: 'fixture-bootstrap-policy-v1' }),
				/non-analyzable module loading/u,
			);
		}
	} finally { await f.cleanup(); }
});

test('bootstrap policy closure rejects a forged node: builtin specifier', async () => {
	const f = await fixture();
	try {
		await mkdir(join(f.root, 'selfhost'), { recursive: true });
		await writeFile(join(f.root, 'selfhost', 'root.js'), "import 'node:not-a-real-virune-builtin';\nexport const root = true;\n", 'utf8');
		await assert.rejects(
			() => hashRelativeModuleClosure({ baseDirectory: f.root, roots: ['selfhost/root.js'], claim: 'fixture-bootstrap-policy-v1' }),
			/unsupported external imports: node:not-a-real-virune-builtin/u,
		);
	} finally { await f.cleanup(); }
});

test('generated Host dynamic-load contract cannot be satisfied by a decoy copy', async () => {
	const f = await fixture();
	try {
		const base = join(f.root, 'dist');
		await mkdir(join(base, 'selfhost'), { recursive: true });
		const expectedContract = [
			'export async function loadBootstrapCompilerCandidate(root, entryModulePath) {',
			"  const canonicalEntryPath = normalizeKernelPath(entryModulePath, '$.entryModulePath');",
			"  if (!canonicalEntryPath.endsWith('.js')) throw new Error('Bootstrap compiler entry module must be JavaScript');",
			'  const moduleUrl = new URL(pathToFileURL(join(root, canonicalEntryPath)).href);',
			"  moduleUrl.searchParams.set('probe', `${Date.now()}-${Math.random()}`);",
			'  return validateSelfhostMvpModule(await import(moduleUrl.href));',
			'}',
		].join('\n');
		const unsafeLiveLoad = [
			'export async function unsafeLoad() {',
			"  const moduleUrl = new URL('https://example.invalid/compiler.js');",
			'  return validateSelfhostMvpModule(await import(moduleUrl.href));',
			'}',
		].join('\n');
		await writeFile(
			join(base, 'selfhost', 'bootstrap-execution-probe.js'),
			`/*\n${expectedContract}\n*/\n${unsafeLiveLoad}\n`,
			'utf8',
		);
		await assert.rejects(
			() => hashRequiredSelfhostHostContract({
				repositoryRoot: f.root,
				compilerDist: base,
				files: ['selfhost/bootstrap-execution-probe.js'],
				claim: 'fixture-host-v3',
			}),
			/does not match reviewed generated:bootstrap-execution-candidate-v1 module provenance/u,
		);
	} finally { await f.cleanup(); }
});
