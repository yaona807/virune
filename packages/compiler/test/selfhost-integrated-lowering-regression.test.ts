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
import { compileWithProjectCompilerBoundary } from '../src/selfhost/project-compiler-adapter.js';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const mvpRoot = join(repositoryRoot, 'selfhost', 'mvp');
const temporaryRoot = join(repositoryRoot, '.test-tmp');
const snapshotOptions = {
	stage: 'stage0' as const,
	compilerVersion: '1.0.0',
	runtimeAbi: '1',
	interopAbi: '1',
	seedSha256: 'd'.repeat(64),
};

type ProjectInput = ReturnType<typeof kernelInputFromProjectBuild>;
type GeneratedCompiler = Awaited<ReturnType<typeof loadBootstrapCompilerCandidate>>;

async function withGeneratedCompiler<T>(
	run: (module: GeneratedCompiler, input: ProjectInput) => T | Promise<T>,
): Promise<T> {
	await mkdir(temporaryRoot, { recursive: true });
	const build = await buildProject(mvpRoot, { write: false });
	const errors = build.diagnostics.filter(item => item.severity === 'error');
	assert.deepEqual(errors.map(item => `${item.code}:${item.message}`), []);
	const artifact = snapshotProjectBuild(build, snapshotOptions);
	const root = await materializeBootstrapCompilerCandidate(artifact, temporaryRoot);
	try {
		const module = await loadBootstrapCompilerCandidate(root, 'dist/main.js');
		return await run(module, kernelInputFromProjectBuild(build));
	} finally {
		await rm(root, { recursive: true, force: true });
		await rm(temporaryRoot, { recursive: true, force: true });
	}
}

const integratedSource = `pub enum Status derives Eq, Debug, Json {
	Pending
	Ready
}

pub record Point derives Eq, Debug, Json {
	x: Int
	y: Int
}

fn makePoint(
	x: Int,
	y: Int,
) -> Point {
	return Point {
		x: x,
		y: y,
	}
}

pub fn main() -> Point {
	return makePoint(20, 22)
}
`;

test('integrated lowering composes enum, record, multiline parameters, and record construction', async () => {
	await withGeneratedCompiler((module, input) => {
		const projectInput: ProjectInput = {
			...input,
			entryPath: 'src/main.virune',
			sources: [{ path: 'src/main.virune', text: integratedSource }],
		};
		const result = compileWithProjectCompilerBoundary(module, projectInput);
		assert.equal(result.accepted, true, JSON.stringify(result.diagnostics, null, 2));
		assert.deepEqual(result.diagnostics, []);
		assert.deepEqual(result.dependencies, []);
		assert.deepEqual(
			result.exportedSymbols.map(item => ({
				modulePath: item.modulePath,
				name: item.name,
				declarationKind: item.declarationKind,
			})),
			[
				{ modulePath: 'src/main.virune', name: 'Point', declarationKind: 'RecordDeclaration' },
				{ modulePath: 'src/main.virune', name: 'Status', declarationKind: 'EnumDeclaration' },
				{ modulePath: 'src/main.virune', name: 'main', declarationKind: 'FunctionDeclaration' },
			],
		);
		assert.equal(result.stats.parsedModules, 1);
		assert.equal(result.stats.checkedModules, 1);
		assert.equal(result.stats.emittedModules, 1);
		const code = result.emittedModules[0]?.code ?? '';
		assert.match(code, /function makePoint\(x, y,/u);
		assert.match(code, /return \(\{x: x, y: y\}\);/u);
		assert.match(code, /export function main/u);
		assert.match(code, /return makePoint\(20, 22, \$ctx\);/u);
		assert.doesNotMatch(code, /enum Status|record Point|Pending|Ready/u);
	});
});
