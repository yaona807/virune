import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { IncrementalProjectBuilder } from '../packages/compiler/dist/src/experimental-api.js';

const root = resolve(import.meta.dirname, '..');
const sizes = (process.env.VIRUNE_BENCHMARK_MODULES ?? '100,500,1000').split(',').map(value => Number.parseInt(value, 10));
if (sizes.some(value => !Number.isSafeInteger(value) || value < 2)) throw new Error('VIRUNE_BENCHMARK_MODULES must contain integers greater than one');
const results = [];
for (const moduleCount of sizes) results.push(await benchmark(moduleCount));
const report = {
	schemaVersion: 1,
	generatedAt: new Date().toISOString(),
	nodeVersion: process.version,
	platform: `${process.platform}-${process.arch}`,
	results,
};
const output = resolve(process.env.VIRUNE_BENCHMARK_OUTPUT ?? join(root, 'benchmarks/incremental/latest.json'));
await mkdir(resolve(output, '..'), { recursive: true });
await writeFile(output, `${JSON.stringify(report, null, '\t')}\n`, 'utf8');
console.log(JSON.stringify(report, null, 2));

async function benchmark(moduleCount) {
	const project = await mkdtemp(join(tmpdir(), `virune-incremental-${moduleCount}-`));
	try {
		const sourceDirectory = join(project, 'src');
		await mkdir(sourceDirectory, { recursive: true });
		await writeFile(join(project, 'virune.json'), `${JSON.stringify({
			languageVersion: '1.0', platform: 'node', sourceDir: 'src', outDir: 'dist', entry: 'src/main.virune', target: 'es2022', sourceMap: false, sourcesContent: false,
		}, null, '\t')}\n`, 'utf8');
		const imports = [];
		for (let index = 1; index < moduleCount; index++) {
			const name = `value${index}`;
			imports.push(`import { ${name} } from "./module${index}.virune"`);
			await writeFile(join(sourceDirectory, `module${index}.virune`), `pub fn ${name}() -> Int => ${index}\n`, 'utf8');
		}
		await writeFile(join(sourceDirectory, 'main.virune'), `${imports.join('\n')}\n\npub fn main() -> Unit {\n\treturn Unit\n}\n`, 'utf8');
		const builder = new IncrementalProjectBuilder();
		const clean = await measure(() => builder.build(project, { write: false }));
		const unchanged = await measure(() => builder.build(project, { write: false }));
		const target = Math.max(1, Math.floor(moduleCount / 2));
		await writeFile(join(sourceDirectory, `module${target}.virune`), `pub fn value${target}() -> Int => ${target + 1}\n`, 'utf8');
		const implementationChange = await measure(() => builder.build(project, { write: false }));
		await writeFile(join(sourceDirectory, `module${target}.virune`), `pub fn value${target}() -> String => "${target}"\n`, 'utf8');
		const signatureChange = await measure(() => builder.build(project, { write: false }));
		return {
			moduleCount,
			clean: summarize(clean),
			unchanged: summarize(unchanged),
			implementationChange: summarize(implementationChange),
			signatureChange: summarize(signatureChange),
		};
	} finally {
		await rm(project, { recursive: true, force: true });
	}
}

async function measure(action) {
	const started = performance.now();
	const result = await action();
	return { milliseconds: Math.round((performance.now() - started) * 100) / 100, result };
}

function summarize(measurement) {
	return {
		milliseconds: measurement.milliseconds,
		diagnostics: measurement.result.diagnostics.length,
		stats: measurement.result.stats,
	};
}
