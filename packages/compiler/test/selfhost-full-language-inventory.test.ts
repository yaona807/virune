import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildProject } from '../src/project/project.js';
import { snapshotProjectBuild } from '../src/selfhost/bootstrap-artifact-snapshot.js';
import {
	loadBootstrapCompilerCandidate,
	materializeBootstrapCompilerCandidate,
} from '../src/selfhost/bootstrap-execution-probe.js';
import { kernelInputFromProjectBuild } from '../src/selfhost/bootstrap-stage-runner.js';
import {
	compileWithProjectCompilerBoundary,
	readProjectCompilerCapability,
} from '../src/selfhost/project-compiler-adapter.js';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const mvpRoot = join(repositoryRoot, 'selfhost', 'mvp');
const temporaryRoot = join(repositoryRoot, '.test-tmp');
const snapshotOptions = {
	stage: 'stage0' as const,
	compilerVersion: '1.0.0',
	runtimeAbi: '1',
	interopAbi: '1',
	seedSha256: 'f'.repeat(64),
};

interface InventoryEntry {
	readonly code: string;
	readonly message: string;
	readonly count: number;
	readonly sourcePaths: readonly string[];
}

interface Inventory {
	readonly sourceCount: number;
	readonly parsedModules: number;
	readonly checkedModules: number;
	readonly diagnosticCount: number;
	readonly entries: readonly InventoryEntry[];
}

function inventoryFromResult(
	sourceCount: number,
	result: ReturnType<typeof compileWithProjectCompilerBoundary>,
): Inventory {
	const groups = new Map<string, {
		message: string;
		count: number;
		sourcePaths: Set<string>;
	}>();
	for (const diagnostic of result.diagnostics) {
		const key = `${diagnostic.code}\u0000${diagnostic.message}`;
		const current = groups.get(key) ?? {
			message: diagnostic.message,
			count: 0,
			sourcePaths: new Set<string>(),
		};
		current.count += 1;
		if (diagnostic.sourcePath !== null) current.sourcePaths.add(diagnostic.sourcePath);
		groups.set(key, current);
	}
	const entries = [...groups.entries()]
		.map(([key, value]) => ({
			code: key.slice(0, key.indexOf('\u0000')),
			message: value.message,
			count: value.count,
			sourcePaths: [...value.sourcePaths].sort(),
		}))
		.sort((left, right) => {
			const code = left.code.localeCompare(right.code);
			if (code !== 0) return code;
			return left.message.localeCompare(right.message);
		});
	return {
		sourceCount,
		parsedModules: result.stats.parsedModules,
		checkedModules: result.stats.checkedModules,
		diagnosticCount: result.diagnostics.length,
		entries,
	};
}

test('full-language lowering blocker inventory is deterministic for the canonical self-host source set', async () => {
	await mkdir(temporaryRoot, { recursive: true });
	const build = await buildProject(mvpRoot, { write: false });
	const buildErrors = build.diagnostics.filter(item => item.severity === 'error');
	assert.deepEqual(buildErrors.map(item => `${item.code}:${item.message}`), []);
	const artifact = snapshotProjectBuild(build, snapshotOptions);
	const root = await materializeBootstrapCompilerCandidate(artifact, temporaryRoot);
	try {
		const module = await loadBootstrapCompilerCandidate(root, 'dist/main.js');
		const capability = readProjectCompilerCapability(module);
		assert.equal(capability.ready, false);
		assert.deepEqual(capability.blockers, ['full-language-lowering-not-implemented']);

		const input = kernelInputFromProjectBuild(build);
		const first = compileWithProjectCompilerBoundary(module, input);
		const second = compileWithProjectCompilerBoundary(module, input);
		assert.deepEqual(first, second);
		assert.equal(first.accepted, false);
		assert.equal(first.stats.parsedModules, input.sources.length);
		assert.equal(first.stats.emittedModules, 0);
		assert.ok(first.diagnostics.length > 0);
		assert.ok(first.diagnostics.every(item => item.code !== 'SHP2001'));

		const inventory = inventoryFromResult(input.sources.length, first);
		assert.deepEqual(inventory, inventoryFromResult(input.sources.length, second));
		assert.equal(inventory.sourceCount, input.sources.length);
		assert.equal(inventory.parsedModules, input.sources.length);
		assert.ok(inventory.entries.length > 0);
		console.log(`SELFHOST_FULL_LANGUAGE_INVENTORY ${JSON.stringify(inventory)}`);
	} finally {
		await rm(root, { recursive: true, force: true });
		await rm(temporaryRoot, { recursive: true, force: true });
	}
});
