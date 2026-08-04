import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { buildProject } from '../project/project.js';
import { snapshotProjectBuild } from './bootstrap-artifact-snapshot.js';
import {
	loadBootstrapCompilerCandidate,
	materializeBootstrapCompilerCandidate,
} from './bootstrap-execution-probe.js';
import { kernelInputFromProjectBuild } from './bootstrap-stage-runner.js';
import {
	compileWithProjectCompilerBoundary,
	hasSelfhostProjectCompilerExports,
	readProjectCompilerCapability,
} from './project-compiler-adapter.js';
import {
	inventoryFromFullLanguageResult,
	type FullLanguageInventory,
} from './full-language-inventory.js';

const snapshotOptions = {
	stage: 'stage0' as const,
	compilerVersion: '1.0.0',
	runtimeAbi: '1',
	interopAbi: '1',
	seedSha256: 'f'.repeat(64),
};

export interface RunFullLanguageInventoryOptions {
	readonly repositoryRoot: string;
}

export async function runFullLanguageInventory(
	options: RunFullLanguageInventoryOptions,
): Promise<FullLanguageInventory> {
	const mvpRoot = join(options.repositoryRoot, 'selfhost', 'mvp');
	const temporaryParent = join(options.repositoryRoot, '.test-tmp');
	await mkdir(temporaryParent, { recursive: true });
	const runRoot = await mkdtemp(join(temporaryParent, 'selfhost-inventory-'));
	try {
		const build = await buildProject(mvpRoot, { write: false });
		const buildErrors = build.diagnostics.filter(item => item.severity === 'error');
		if (buildErrors.length > 0) {
			throw new Error(`Self-host MVP build failed: ${buildErrors.map(item => `${item.code}:${item.message}`).join('; ')}`);
		}
		const artifact = snapshotProjectBuild(build, snapshotOptions);
		const candidateRoot = await materializeBootstrapCompilerCandidate(artifact, runRoot);
		const module = await loadBootstrapCompilerCandidate(candidateRoot, 'dist/main.js');
		if (!hasSelfhostProjectCompilerExports(module)) {
			throw new Error('Generated compiler must export the project compiler boundary');
		}
		const capability = readProjectCompilerCapability(module);
		if (capability === null) throw new Error('Generated compiler did not expose project compiler capability');

		const input = kernelInputFromProjectBuild(build);
		const first = compileWithProjectCompilerBoundary(module, input);
		const second = compileWithProjectCompilerBoundary(module, input);
		if (JSON.stringify(first) !== JSON.stringify(second)) {
			throw new Error('Generated project compiler returned non-deterministic results');
		}
		const inventory = inventoryFromFullLanguageResult(
			input.sources.map(source => source.path),
			first,
			capability,
		);
		if (inventory.boundaryBlockers.length > 0) {
			throw new Error(`Full-language inventory boundary regression: ${inventory.boundaryBlockers.join(', ')}`);
		}
		return inventory;
	} finally {
		await rm(runRoot, { recursive: true, force: true });
	}
}
