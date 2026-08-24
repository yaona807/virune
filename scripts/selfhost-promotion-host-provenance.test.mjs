import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { validateGeneratedDynamicLoadingBoundary } from './selfhost-promotion-host-contract.mjs';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
const compilerDist = join(repositoryRoot, 'packages', 'compiler', 'dist', 'src');

const boundaries = [
	{
		fileName: 'selfhost/bootstrap-execution-probe.js',
		binding: 'generated:bootstrap-execution-candidate-v1',
		targetLine: 'return validateSelfhostMvpModule(await import(moduleUrl.href));',
		withoutLoad: 'return validateSelfhostMvpModule({});',
		duplicateLoad: 'await import(moduleUrl.href); return validateSelfhostMvpModule(await import(moduleUrl.href));',
		retarget(source) {
			return source.replace(
				"const module = await loadBootstrapCompilerCandidate(temporaryDirectory, options.entryModulePath ?? 'dist/main.js');",
				"const module = await loadBootstrapCompilerCandidate(process.env.VIRUNE_BOOTSTRAP_ROOT, options.entryModulePath ?? 'dist/main.js');",
			);
		},
	},
	{
		fileName: 'selfhost/bootstrap-stage-loader.js',
		binding: 'generated:bootstrap-stage-compiler-candidate-v1',
		targetLine: 'const loaded = await import(moduleUrl.href);',
		withoutLoad: 'const loaded = {};',
		duplicateLoad: 'await import(moduleUrl.href); const loaded = await import(moduleUrl.href);',
		retarget(source) {
			return source.replace(
				'const entryModulePath = entryCandidates[0];',
				'entryCandidates[0] = process.env.VIRUNE_STAGE_ENTRY; const entryModulePath = entryCandidates[0];',
			);
		},
	},
];

for (const boundary of boundaries) {
	test(`${boundary.binding} binds the reviewed generated-artifact provenance, not only the import target line`, async () => {
		const source = await readFile(join(compilerDist, boundary.fileName), 'utf8');
		const accepted = await validateGeneratedDynamicLoadingBoundary(source, boundary.fileName);
		assert.deepEqual(accepted, {
			warningId: 'unsupported-dynamic-import',
			count: 1,
			binding: boundary.binding,
		});

		const retargeted = boundary.retarget(source);
		assert.notEqual(retargeted, source, 'the regression mutation must change the reviewed provenance while retaining the dynamic import line');
		await assert.rejects(
			() => validateGeneratedDynamicLoadingBoundary(retargeted, boundary.fileName),
			new RegExp(`does not match reviewed ${boundary.binding.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')} module provenance`, 'u'),
		);
	});

	test(`${boundary.binding} requires exactly one reviewed generated-artifact load`, async () => {
		const source = await readFile(join(compilerDist, boundary.fileName), 'utf8');
		const withoutLoad = source.replace(boundary.targetLine, boundary.withoutLoad);
		assert.notEqual(withoutLoad, source, 'the zero-load regression mutation must remove the reviewed dynamic load');
		await assert.rejects(
			() => validateGeneratedDynamicLoadingBoundary(withoutLoad, boundary.fileName),
			new RegExp(`must contain exactly 1 ${boundary.binding.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')} dynamic load; received 0`, 'u'),
		);

		const duplicated = source.replace(boundary.targetLine, boundary.duplicateLoad);
		assert.notEqual(duplicated, source, 'the duplicate-load regression mutation must duplicate the reviewed dynamic load');
		await assert.rejects(
			() => validateGeneratedDynamicLoadingBoundary(duplicated, boundary.fileName),
			new RegExp(`must contain exactly 1 ${boundary.binding.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')} dynamic load; received 2`, 'u'),
		);
	});
}
