import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyTypeScriptBoundary } from './verify-typescript-boundary.mjs';

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const policyPath = resolve(repositoryRoot, '.github/typescript-version-policy.json');
const outputDirectory = resolve(repositoryRoot, '.cache/typescript-7-prototype');
const excludedDirectories = new Set(['.git', '.cache', '.vscode-test', 'coverage', 'node_modules', 'release']);

export async function probeTypeScript7({ root = repositoryRoot, output = outputDirectory } = {}) {
	await rm(output, { recursive: true, force: true });
	await mkdir(output, { recursive: true });
	const policy = JSON.parse(await readFile(resolve(root, relative(repositoryRoot, policyPath)), 'utf8'));
	const toolRoot = await mkdtemp(resolve(tmpdir(), 'virune-typescript7-toolchain-'));
	const commands = [];
	let report;
	try {
		await verifyTypeScriptBoundary({
			root,
			policyFile: resolve(root, '.github/typescript-version-policy.json'),
			reportPath: relative(root, resolve(output, 'boundary.json')),
		});
		await installTypeScript7(toolRoot, policy.target.buildSpecifier, commands, output);
		const currentVersion = runText(process.execPath, ['-e', "import('typescript').then(module => process.stdout.write(module.default.version))"], root).trim();
		const nativeCompiler = resolve(toolRoot, 'node_modules/.bin', process.platform === 'win32' ? 'tsc.cmd' : 'tsc');
		const nativeVersion = runText(nativeCompiler, ['--version'], root).trim().replace(/^Version\s+/, '');
		if (currentVersion !== policy.current.compilerApi) throw new Error(`Expected TypeScript ${policy.current.compilerApi} API, received ${currentVersion}`);
		if (nativeVersion !== policy.target.buildVersion) throw new Error(`Expected TypeScript ${policy.target.buildVersion} build compiler, received ${nativeVersion}`);

		await runCommand('clean-before-typescript6', npmCommand(), ['run', 'clean'], root, commands, output);
		await runCommand('typescript6-clean-build', resolve(root, 'node_modules/.bin', process.platform === 'win32' ? 'tsc.cmd' : 'tsc'), ['-b', '--force', '--pretty', 'false'], root, commands, output);
		const typescript6Output = await describeEmittedTree(root);

		await runCommand('clean-before-typescript7', npmCommand(), ['run', 'clean'], root, commands, output);
		await runCommand('typescript7-clean-build', nativeCompiler, ['-b', '--force', '--pretty', 'false', '--singleThreaded'], root, commands, output);
		const typescript7Output = await describeEmittedTree(root);
		const outputDifferences = compareTrees(typescript6Output, typescript7Output);

		const beforeIncremental = await describeEmittedTree(root);
		await runCommand('typescript7-incremental-build', nativeCompiler, ['-b', '--pretty', 'false', '--singleThreaded'], root, commands, output);
		const afterIncremental = await describeEmittedTree(root);
		const incrementalDifferences = compareTrees(beforeIncremental, afterIncremental);

		await runCommand('js-interop-tests', npmCommand(), ['--workspace', '@virune/js-interop', 'test'], root, commands, output);
		await runCommand('binding-corpus', npmCommand(), ['run', 'test:binding-corpus:built'], root, commands, output, {
			VIRUNE_BINDING_CORPUS_REPORT: resolve(output, 'binding-corpus.json'),
		});
		await runCommand('language-server-and-vscode', npmCommand(), ['run', 'test:vscode:built'], root, commands, output);
		await runCommand('vsix-package', process.execPath, ['scripts/package-vscode.mjs'], root, commands, output);

		const failures = commands.filter(item => item.status !== 0);
		if (policy.prototype.requireExactEmitMatch && outputDifferences.length > 0) {
			failures.push({ id: 'typescript6-typescript7-output', status: 1 });
		}
		if (incrementalDifferences.length > 0) failures.push({ id: 'typescript7-incremental-output', status: 1 });
		report = {
			schemaVersion: 1,
			generatedAt: new Date().toISOString(),
			versions: { compilerApi: currentVersion, buildCompiler: nativeVersion },
			commands,
			emit: {
				typescript6Files: typescript6Output.size,
				typescript7Files: typescript7Output.size,
				outputDifferences,
				incrementalDifferences,
			},
			passed: failures.length === 0,
		};
	} catch (error) {
		report = {
			schemaVersion: 1,
			generatedAt: new Date().toISOString(),
			commands,
			emit: { outputDifferences: [], incrementalDifferences: [] },
			passed: false,
			error: error instanceof Error ? error.stack ?? error.message : String(error),
		};
	} finally {
		await writeFile(resolve(output, 'report.json'), `${JSON.stringify(report, null, '\t')}\n`, 'utf8');
		await writeSummary(output, report);
		await rm(toolRoot, { recursive: true, force: true });
	}
	if (!report.passed) throw new Error(`TypeScript 7 migration prototype failed. Review ${resolve(output, 'summary.md')}`);
	console.log(`TypeScript 7 migration prototype passed. Evidence: ${resolve(output, 'report.json')}`);
	return report;
}

async function installTypeScript7(toolRoot, specifier, commands, output) {
	await writeFile(resolve(toolRoot, 'package.json'), `${JSON.stringify({ private: true, devDependencies: { '@typescript/native': specifier } }, null, '\t')}\n`, 'utf8');
	await runCommand('install-typescript7-toolchain', npmCommand(), ['install', '--no-audit', '--no-fund', '--ignore-scripts=false'], toolRoot, commands, output);
}

async function runCommand(id, executable, argumentsList, cwd, commands, output, additionalEnvironment = {}) {
	const startedAt = Date.now();
	const result = spawnSync(executable, argumentsList, {
		cwd,
		env: { ...process.env, CI: '1', ...additionalEnvironment },
		encoding: 'utf8',
		maxBuffer: 256 * 1024 * 1024,
	});
	const record = {
		id,
		command: [executable, ...argumentsList],
		status: result.error === undefined ? result.status ?? 1 : 1,
		durationMs: Date.now() - startedAt,
	};
	commands.push(record);
	await writeFile(resolve(output, `${id}.log`), `${result.stdout ?? ''}${result.stderr ?? ''}${result.error === undefined ? '' : `\n${result.error.stack ?? result.error.message}\n`}`, 'utf8');
	if (record.status !== 0) throw new Error(`${id} failed with status ${record.status}`);
	return record;
}

function runText(executable, argumentsList, cwd) {
	const result = spawnSync(executable, argumentsList, { cwd, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
	if (result.error !== undefined || result.status !== 0) throw new Error(`${executable} ${argumentsList.join(' ')} failed: ${result.stderr || result.error?.message}`);
	return result.stdout;
}

async function describeEmittedTree(root) {
	const files = new Map();
	await visit(root);
	return files;

	async function visit(directory) {
		for (const entry of await readdir(directory, { withFileTypes: true })) {
			if (entry.isDirectory() && excludedDirectories.has(entry.name)) continue;
			const absolute = resolve(directory, entry.name);
			if (entry.isDirectory()) {
				if (entry.name === 'dist') await collectDist(absolute);
				else await visit(absolute);
			}
		}
	}

	async function collectDist(directory) {
		for (const entry of await readdir(directory, { withFileTypes: true })) {
			const absolute = resolve(directory, entry.name);
			if (entry.isDirectory()) await collectDist(absolute);
			else if (entry.isFile() && !entry.name.endsWith('.tsbuildinfo')) {
				const bytes = await readFile(absolute);
				const metadata = await lstat(absolute);
				files.set(relative(root, absolute).split(sep).join('/'), {
					sha256: createHash('sha256').update(bytes).digest('hex'),
					bytes: bytes.byteLength,
					mode: metadata.mode & 0o777,
				});
			}
		}
	}
}

function compareTrees(left, right) {
	const differences = [];
	for (const path of [...new Set([...left.keys(), ...right.keys()])].sort()) {
		const a = left.get(path);
		const b = right.get(path);
		if (a === undefined || b === undefined) differences.push({ kind: 'missing-file', path, typescript6: a ?? null, typescript7: b ?? null });
		else if (a.sha256 !== b.sha256 || a.mode !== b.mode) differences.push({ kind: 'file-difference', path, typescript6: a, typescript7: b });
	}
	return differences;
}

async function writeSummary(output, report) {
	const lines = [
		'# TypeScript 7 migration prototype',
		'',
		`Result: **${report.passed ? 'PASS' : 'FAIL'}**`,
		'',
		`Compiler API version: ${report.versions?.compilerApi ?? 'unknown'}`,
		`Build compiler version: ${report.versions?.buildCompiler ?? 'unknown'}`,
		`Emit differences: ${report.emit.outputDifferences.length}`,
		`Incremental emit differences: ${report.emit.incrementalDifferences.length}`,
		'',
		'## Commands',
		'',
		...report.commands.map(item => `- ${item.status === 0 ? 'PASS' : 'FAIL'} \`${item.id}\` (${item.durationMs} ms)`),
	];
	if (report.error !== undefined) lines.push('', '## Error', '', '```text', report.error, '```');
	await writeFile(resolve(output, 'summary.md'), `${lines.join('\n')}\n`, 'utf8');
}

function npmCommand() { return process.platform === 'win32' ? 'npm.cmd' : 'npm'; }

const entry = process.argv[1] === undefined ? undefined : resolve(process.argv[1]);
if (entry === fileURLToPath(import.meta.url)) await probeTypeScript7();
