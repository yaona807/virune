import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { spawnNpmSync } from './npm-cli.mjs';
import typescript from 'typescript';

const root = resolve(import.meta.dirname, '..');
const manifestPath = join(root, 'corpus/bindings/packages.json');
const baselinePath = join(root, 'corpus/bindings/report.json');
const corpusLockPath = join(root, 'corpus/bindings/package-lock.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const workspace = resolve(process.env.VIRUNE_BINDING_CORPUS_WORKDIR ?? join(root, '.cache/binding-corpus'));
const outputDirectory = join(workspace, 'generated');
const writeBaseline = process.argv.includes('--write-report');
const currentReportPath = resolve(process.env.VIRUNE_BINDING_CORPUS_REPORT ?? join(workspace, 'report.current.json'));
const baselineDiffPath = join(workspace, 'baseline-diff.json');
const workspaceLockPath = join(workspace, 'package-lock.json');

await rm(outputDirectory, { recursive: true, force: true });
await rm(baselineDiffPath, { force: true });
await mkdir(outputDirectory, { recursive: true });
const dependencies = Object.fromEntries(manifest.packages.flatMap(item => [
	[item.name, item.version],
	...(item.typesPackage === undefined ? [] : [[item.typesPackage, item.typesVersion]]),
]));
await writeFile(join(workspace, 'package.json'), `${JSON.stringify({ private: true, type: 'module', dependencies }, null, '\t')}\n`, 'utf8');
const hasCommittedLock = existsSync(corpusLockPath);
if (hasCommittedLock) await copyFile(corpusLockPath, workspaceLockPath);
const installMode = hasCommittedLock && !writeBaseline ? 'ci' : 'install';
const install = spawnNpmSync([installMode, '--ignore-scripts', '--no-audit', '--no-fund'], {
	cwd: workspace,
	stdio: 'inherit',
});
if (install.error !== undefined) throw new Error(`Failed to start npm: ${install.error.message}`);
if (install.status !== 0) {
	const hint = installMode === 'ci' ? '; run npm run test:binding-corpus:update if the corpus manifest changed' : '';
	throw new Error(`npm ${installMode} failed with exit code ${install.status ?? 'unknown'}${hint}`);
}

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
const failures = results.filter(item => item.status === 'failure');
if (failures.length > 0) {
	throw new Error(`Binding generation failed for ${failures.map(item => `${item.name}@${item.version}`).join(', ')}`);
}
if (summary.generationSuccessRate < manifest.thresholds.minimumGenerationSuccessRate) throw new Error(`Binding corpus generation success rate ${summary.generationSuccessRate} is below ${manifest.thresholds.minimumGenerationSuccessRate}`);
if (summary.nonEmptyRate < manifest.thresholds.minimumNonEmptyRate) throw new Error(`Binding corpus non-empty rate ${summary.nonEmptyRate} is below ${manifest.thresholds.minimumNonEmptyRate}`);
if (writeBaseline) {
	await writeFile(baselinePath, `${JSON.stringify(report, null, '\t')}\n`, 'utf8');
	await copyFile(workspaceLockPath, corpusLockPath);
}
else await verifyBaseline(baselinePath, results, baselineDiffPath);
console.log(JSON.stringify(report, null, 2));

function fileName(name) { return `${name.replace(/^@/u, '').replace(/[^A-Za-z0-9_-]/gu, '-')}.virune`; }
function digest(value) { return createHash('sha256').update(value).digest('hex'); }
function ratio(numerator, denominator) { return denominator === 0 ? 1 : Math.round((numerator / denominator) * 10000) / 10000; }

async function verifyBaseline(path, currentResults, diffPath) {
	const baseline = JSON.parse(await readFile(path, 'utf8'));
	const expected = new Map(baseline.packages.map(item => [`${item.name}@${item.version}`, item]));
	const differences = [];
	if (expected.size !== currentResults.length) {
		differences.push({
			kind: 'package-count',
			expected: expected.size,
			actual: currentResults.length,
		});
	}
	for (const current of currentResults) {
		const key = `${current.name}@${current.version}`;
		const previous = expected.get(key);
		if (previous === undefined) {
			differences.push({ kind: 'unreviewed-package', package: key, current });
			continue;
		}
		if (previous.status !== current.status) {
			differences.push({
				kind: 'status',
				package: key,
				expected: previous.status,
				actual: current.status,
			});
			continue;
		}
		if (current.status === 'failure') {
			differences.push({ kind: 'generation-failure', package: key, error: current.error });
			continue;
		}
		if (previous.outputHash !== current.outputHash) {
			differences.push({
				kind: 'output-hash',
				package: key,
				expectedHash: previous.outputHash,
				actualHash: current.outputHash,
				expectedMetrics: bindingMetrics(previous),
				actualMetrics: bindingMetrics(current),
			});
		}
	}
	if (differences.length === 0) return;
	await writeFile(diffPath, `${JSON.stringify({ schemaVersion: 1, differences }, null, '\t')}\n`, 'utf8');
	const summary = differences.map(difference => {
		if (difference.package === undefined) return `${difference.kind}: expected ${difference.expected}, received ${difference.actual}`;
		if (difference.kind === 'output-hash') return `${difference.package}: binding output hash changed`;
		if (difference.kind === 'generation-failure') return `${difference.package}: ${difference.error}`;
		return `${difference.package}: ${difference.kind}`;
	});
	throw new Error(
		`Binding corpus baseline differs in ${differences.length} place(s):\n- ${summary.join('\n- ')}\n` +
		`Review ${diffPath} and generated outputs, then run npm run test:binding-corpus:update.`,
	);
}

function bindingMetrics(item) {
	return {
		generatedFunctions: item.generatedFunctions ?? 0,
		generatedRecords: item.generatedRecords ?? 0,
		warnings: item.warnings ?? 0,
		unknownMappings: item.unknownMappings ?? 0,
	};
}
