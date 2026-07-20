import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import typescript from 'typescript';

const root = resolve(import.meta.dirname, '..');
const manifestPath = join(root, 'corpus/bindings/packages.json');
const baselinePath = join(root, 'corpus/bindings/report.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const workspace = resolve(process.env.VIRUNE_BINDING_CORPUS_WORKDIR ?? join(root, '.cache/binding-corpus'));
const outputDirectory = join(workspace, 'generated');
const writeBaseline = process.argv.includes('--write-report');
const currentReportPath = resolve(process.env.VIRUNE_BINDING_CORPUS_REPORT ?? join(workspace, 'report.current.json'));

await mkdir(outputDirectory, { recursive: true });
const dependencies = Object.fromEntries(manifest.packages.flatMap(item => [
	[item.name, item.version],
	...(item.typesPackage === undefined ? [] : [[item.typesPackage, item.typesVersion]]),
]));
await writeFile(join(workspace, 'package.json'), `${JSON.stringify({ private: true, type: 'module', dependencies }, null, '\t')}\n`, 'utf8');
const install = spawnSync('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false'], { cwd: workspace, stdio: 'inherit' });
if (install.status !== 0) throw new Error(`npm install failed with exit code ${install.status ?? 'unknown'}`);

const results = [];
for (const item of manifest.packages) {
	console.log(`[binding-corpus] ${item.name}@${item.version}`);
	const outputPath = join(outputDirectory, fileName(item.name));
	try {
		const worker = spawnSync(process.execPath, [join(root, 'scripts/run-binding-package.mjs'), workspace, item.typesPackage ?? item.name, outputPath, item.name], { encoding: 'utf8', timeout: 60000 });
		if (worker.status !== 0) throw new Error((worker.stderr || worker.stdout || `worker exited with ${worker.status ?? 'unknown'}`).trim());
		const generated = JSON.parse(worker.stdout.trim().split(/\r?\n/u).at(-1));
		const outputHash = digest(await readFile(outputPath, 'utf8'));
		results.push({ ...item, status: 'success', ...generated, outputHash });
	} catch (error) {
		results.push({ ...item, status: 'failure', error: error instanceof Error ? error.message : String(error) });
	}
}

const successes = results.filter(item => item.status === 'success');
const nonEmpty = successes.filter(item => (item.generatedFunctions ?? 0) + (item.generatedRecords ?? 0) > 0);
const summary = {
	packageCount: results.length,
	successfulPackages: successes.length,
	nonEmptyPackages: nonEmpty.length,
	generationSuccessRate: ratio(successes.length, results.length),
	nonEmptyRate: ratio(nonEmpty.length, results.length),
	totalFunctions: successes.reduce((sum, item) => sum + (item.generatedFunctions ?? 0), 0),
	totalRecords: successes.reduce((sum, item) => sum + (item.generatedRecords ?? 0), 0),
	totalWarnings: successes.reduce((sum, item) => sum + (item.warnings ?? 0), 0),
	totalUnknownMappings: successes.reduce((sum, item) => sum + (item.unknownMappings ?? 0), 0),
};
const report = { schemaVersion: 1, generatedAt: new Date().toISOString(), typescriptVersion: typescript.version, thresholds: manifest.thresholds, summary, packages: results };
await mkdir(resolve(currentReportPath, '..'), { recursive: true });
await writeFile(currentReportPath, `${JSON.stringify(report, null, '\t')}\n`, 'utf8');
if (writeBaseline) await writeFile(baselinePath, `${JSON.stringify(report, null, '\t')}\n`, 'utf8');
else await verifyBaseline(baselinePath, results);
console.log(JSON.stringify(report, null, 2));
if (summary.generationSuccessRate < manifest.thresholds.minimumGenerationSuccessRate) throw new Error(`Binding corpus generation success rate ${summary.generationSuccessRate} is below ${manifest.thresholds.minimumGenerationSuccessRate}`);
if (summary.nonEmptyRate < manifest.thresholds.minimumNonEmptyRate) throw new Error(`Binding corpus non-empty rate ${summary.nonEmptyRate} is below ${manifest.thresholds.minimumNonEmptyRate}`);

function fileName(name) { return `${name.replace(/^@/u, '').replace(/[^A-Za-z0-9_-]/gu, '-')}.virune`; }
function digest(value) { return createHash('sha256').update(value).digest('hex'); }
function ratio(numerator, denominator) { return denominator === 0 ? 1 : Math.round((numerator / denominator) * 10000) / 10000; }

async function verifyBaseline(path, currentResults) {
	const baseline = JSON.parse(await readFile(path, 'utf8'));
	const expected = new Map(baseline.packages.map(item => [`${item.name}@${item.version}`, item]));
	if (expected.size !== currentResults.length) throw new Error(`Binding corpus package count changed: expected ${expected.size}, received ${currentResults.length}`);
	for (const current of currentResults) {
		const key = `${current.name}@${current.version}`;
		const previous = expected.get(key);
		if (previous === undefined) throw new Error(`Binding corpus contains unreviewed package ${key}`);
		if (previous.status !== current.status) throw new Error(`Binding status changed for ${key}: ${previous.status} -> ${current.status}`);
		if (current.status === 'failure') throw new Error(`Binding generation failed for ${key}: ${current.error}`);
		if (previous.outputHash !== current.outputHash) throw new Error(`Binding output changed for ${key}; run npm run test:binding-corpus:update after reviewing the diff`);
	}
}
