import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { runFullLanguageInventory } from '../src/selfhost/full-language-inventory-runner.js';

const executeFile = promisify(execFile);
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');

const patchInputs = [
	'.github/scripts/tmp-apply-full-language-readiness.py',
	'docs/self-hosting-project-compiler-integration.md',
	'docs/self-hosting-project-compiler-integration_ja.md',
	'docs/self-hosting-stage1-stage2-bootstrap.md',
	'docs/self-hosting-stage1-stage2-bootstrap_ja.md',
	'packages/compiler/test/selfhost-bootstrap-stage-runner.test.ts',
	'packages/compiler/test/selfhost-full-language-inventory.test.ts',
	'packages/compiler/test/selfhost-project-compiler-contract.test.ts',
	'packages/compiler/test/selfhost-qualified-builtins-variants.test.ts',
	'selfhost/mvp',
] as const;

test('full-language diagnostic probe reports the patched canonical inventory', { timeout: 1_800_000 }, async () => {
	const temporaryParent = await mkdtemp(join(tmpdir(), 'virune-full-language-probe-'));
	const probeRoot = join(temporaryParent, 'repository');
	try {
		for (const relativePath of patchInputs) {
			const source = join(repositoryRoot, relativePath);
			const destination = join(probeRoot, relativePath);
			await mkdir(dirname(destination), { recursive: true });
			await cp(source, destination, { recursive: true });
		}
		await executeFile(
			'python',
			['.github/scripts/tmp-apply-full-language-readiness.py'],
			{ cwd: probeRoot, maxBuffer: 16 * 1024 * 1024 },
		);
		const capabilityPath = join(
			probeRoot,
			'selfhost',
			'mvp',
			'src',
			'project-compiler-contract.virune',
		);
		const capabilitySource = await readFile(capabilityPath, 'utf8');
		const readyCapability = [
			'\t\tready: true,',
			'\t\trequestSchema: "virune.selfhost.project-compiler.request.v1",',
			'\t\tresultSchema: "virune.selfhost.project-compiler.result.v2",',
			'\t\tblockers: [],',
		].join('\n');
		const probeCapability = [
			'\t\tready: false,',
			'\t\trequestSchema: "virune.selfhost.project-compiler.request.v1",',
			'\t\tresultSchema: "virune.selfhost.project-compiler.result.v2",',
			'\t\tblockers: ["diagnostic-probe-pending-full-language-inventory"],',
		].join('\n');
		assert.equal(
			capabilitySource.split(readyCapability).length - 1,
			1,
			'readiness patch must produce exactly one ready capability block',
		);
		await writeFile(
			capabilityPath,
			capabilitySource.replace(readyCapability, probeCapability),
			'utf8',
		);
		const inventory = await runFullLanguageInventory({ repositoryRoot: probeRoot });
		assert.equal(inventory.capability.ready, false);
		assert.deepEqual(
			inventory.capability.blockers,
			['diagnostic-probe-pending-full-language-inventory'],
		);
		console.log(`SELFHOST_FULL_LANGUAGE_PROBE ${JSON.stringify(inventory)}`);
	} finally {
		await rm(temporaryParent, { recursive: true, force: true });
	}
});
