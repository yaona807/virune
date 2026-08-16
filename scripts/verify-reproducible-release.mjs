import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, readlink, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, extname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const excludedSegments = new Set(['.git', '.cache', '.vscode-test', 'coverage', 'dist', 'node_modules']);
const excludedTopLevelPaths = new Set(['release']);
const archiveExtensions = new Set(['.tgz', '.vsix']);

export async function verifyReproducibleRelease({
	root = repositoryRoot,
	outputDirectory = resolve(root, '.cache/reproducible-release'),
	executeBuild = buildRelease,
} = {}) {
	await rm(outputDirectory, { recursive: true, force: true });
	await mkdir(outputDirectory, { recursive: true });
	const temporaryRoot = await mkdtemp(resolve(tmpdir(), 'virune-reproducible-release-'));
	const workspaces = [resolve(temporaryRoot, 'build-a'), resolve(temporaryRoot, 'build-b')];
	const builds = [];
	let report;
	try {
		for (const [index, workspace] of workspaces.entries()) {
			await copyCleanWorkspace(root, workspace);
			const logPath = resolve(outputDirectory, `build-${index === 0 ? 'a' : 'b'}.log`);
			const startedAt = Date.now();
			const result = await executeBuild(workspace, logPath);
			builds.push({
				id: index === 0 ? 'a' : 'b',
				workspace,
				log: relative(root, logPath).split(sep).join('/'),
				durationMs: Date.now() - startedAt,
				status: result.status,
			});
			if (result.status !== 0) throw new Error(`Independent release build ${index === 0 ? 'A' : 'B'} failed. See ${logPath}`);
		}

		const comparison = await compareReleaseDirectories(
			resolve(workspaces[0], 'release'),
			resolve(workspaces[1], 'release'),
			{ forbiddenPaths: workspaces },
		);
		report = {
			schemaVersion: 1,
			generatedAt: new Date().toISOString(),
			sourceDateEpoch: reproducibleEnvironment().SOURCE_DATE_EPOCH,
			builds,
			...comparison,
		};
		if (!comparison.passed) {
			const evidenceRoot = resolve(outputDirectory, 'artifacts');
			await cp(resolve(workspaces[0], 'release'), resolve(evidenceRoot, 'build-a'), { recursive: true });
			await cp(resolve(workspaces[1], 'release'), resolve(evidenceRoot, 'build-b'), { recursive: true });
		}
	} catch (error) {
		report ??= {
			schemaVersion: 1,
			generatedAt: new Date().toISOString(),
			sourceDateEpoch: reproducibleEnvironment().SOURCE_DATE_EPOCH,
			builds,
			passed: false,
			differences: [{ kind: 'build-failure', message: error instanceof Error ? error.message : String(error) }],
			archives: [],
		};
	} finally {
		await writeReport(outputDirectory, report);
		if (process.env.VIRUNE_KEEP_REPRO_WORKSPACES !== '1') await rm(temporaryRoot, { recursive: true, force: true });
	}

	if (!report.passed) throw new Error(`Release artifacts are not reproducible. Review ${resolve(outputDirectory, 'summary.md')}`);
	console.log(`Release artifacts are reproducible. Evidence: ${resolve(outputDirectory, 'report.json')}`);
	return report;
}

export async function compareReleaseDirectories(leftRoot, rightRoot, { forbiddenPaths = [] } = {}) {
	const differences = [];
	const leftEntries = await describeTree(leftRoot);
	const rightEntries = await describeTree(rightRoot);
	compareTreeEntries(leftEntries, rightEntries, differences, 'release');
	await scanForWorkspacePaths(leftRoot, forbiddenPaths, differences, 'build-a');
	await scanForWorkspacePaths(rightRoot, forbiddenPaths, differences, 'build-b');

	const archives = [];
	const archivePaths = [...new Set([...leftEntries.keys(), ...rightEntries.keys()])]
		.filter(path => archiveExtensions.has(extension(path)))
		.sort();
	for (const path of archivePaths) {
		const left = leftEntries.get(path);
		const right = rightEntries.get(path);
		if (left?.type !== 'file' || right?.type !== 'file') continue;
		const archive = { path, rawEqual: left.sha256 === right.sha256, expandedEqual: false };
		const expanded = await compareExpandedArchive(resolve(leftRoot, path), resolve(rightRoot, path), forbiddenPaths);
		archive.expandedEqual = expanded.differences.length === 0;
		archive.entryCount = expanded.entryCount;
		archives.push(archive);
		for (const difference of expanded.differences) differences.push({ ...difference, archive: path });
		if (!archive.rawEqual && archive.expandedEqual) differences.push({
			kind: 'archive-metadata-or-order',
			path,
			message: 'Archive bytes differ even though the expanded file trees match. Check timestamps, entry order, compression metadata, and permissions.',
		});
	}

	return { passed: differences.length === 0, differences, archives };
}

export async function copyCleanWorkspace(root, destination) {
	await cp(root, destination, {
		recursive: true,
		preserveTimestamps: true,
		filter(source) {
			const path = relative(root, source);
			if (path === '') return true;
			const segments = path.split(sep);
			if (excludedTopLevelPaths.has(segments[0])) return false;
			return !segments.some(segment => excludedSegments.has(segment));
		},
	});
}

async function buildRelease(workspace, logPath) {
	await mkdir(dirname(logPath), { recursive: true });
	const commands = [
		['ci', '--no-audit', '--no-fund'],
		['run', 'verify:release'],
	];
	let output = '';
	for (const argumentsList of commands) {
		const executable = process.platform === 'win32' ? 'npm.cmd' : 'npm';
		const result = spawnSync(executable, argumentsList, {
			cwd: workspace,
			env: reproducibleEnvironment(),
			encoding: 'utf8',
			maxBuffer: 256 * 1024 * 1024,
		});
		output += `\n$ npm ${argumentsList.join(' ')}\n${result.stdout ?? ''}${result.stderr ?? ''}`;
		if (result.error !== undefined) {
			output += `\n${result.error.stack ?? result.error.message}\n`;
			await writeFile(logPath, output, 'utf8');
			return { status: 1 };
		}
		if (result.status !== 0) {
			await writeFile(logPath, output, 'utf8');
			return { status: result.status ?? 1 };
		}
	}
	await writeFile(logPath, output, 'utf8');
	return { status: 0 };
}

function reproducibleEnvironment() {
	return {
		...process.env,
		CI: '1',
		LANG: 'C',
		LC_ALL: 'C',
		TZ: 'UTC',
		SOURCE_DATE_EPOCH: process.env.SOURCE_DATE_EPOCH ?? '0',
	};
}

async function describeTree(root) {
	const entries = new Map();
	await visit(root, '');
	return entries;

	async function visit(absolute, path) {
		const metadata = await lstat(absolute);
		if (path !== '') {
			const common = { path, mode: metadata.mode & 0o777 };
			if (metadata.isDirectory()) entries.set(path, { ...common, type: 'directory' });
			else if (metadata.isSymbolicLink()) entries.set(path, { ...common, type: 'symlink', target: await readlink(absolute) });
			else if (metadata.isFile()) {
				const bytes = await readFile(absolute);
				entries.set(path, { ...common, type: 'file', bytes: bytes.byteLength, sha256: digest(bytes) });
			}
		}
		if (!metadata.isDirectory()) return;
		for (const child of (await readdir(absolute)).sort()) {
			const childPath = path === '' ? child : `${path}/${child}`;
			await visit(resolve(absolute, child), childPath);
		}
	}
}

function compareTreeEntries(left, right, differences, scope) {
	const paths = [...new Set([...left.keys(), ...right.keys()])].sort();
	for (const path of paths) {
		const a = left.get(path);
		const b = right.get(path);
		if (a === undefined || b === undefined) {
			differences.push({ kind: 'missing-entry', scope, path, buildA: a ?? null, buildB: b ?? null });
			continue;
		}
		if (a.type !== b.type) differences.push({ kind: 'entry-type', scope, path, buildA: a.type, buildB: b.type });
		if (a.mode !== b.mode) differences.push({ kind: 'file-mode', scope, path, buildA: octal(a.mode), buildB: octal(b.mode) });
		if (a.type === 'file' && b.type === 'file' && a.sha256 !== b.sha256) differences.push({
			kind: 'file-content', scope, path,
			buildA: { sha256: a.sha256, bytes: a.bytes },
			buildB: { sha256: b.sha256, bytes: b.bytes },
		});
		if (a.type === 'symlink' && b.type === 'symlink' && a.target !== b.target) differences.push({ kind: 'symlink-target', scope, path, buildA: a.target, buildB: b.target });
	}
}

async function compareExpandedArchive(leftArchive, rightArchive, forbiddenPaths) {
	const temporaryRoot = await mkdtemp(resolve(tmpdir(), 'virune-repro-archive-'));
	try {
		const left = resolve(temporaryRoot, 'a');
		const right = resolve(temporaryRoot, 'b');
		await mkdir(left, { recursive: true });
		await mkdir(right, { recursive: true });
		extractArchive(leftArchive, left);
		extractArchive(rightArchive, right);
		const leftEntries = await describeTree(left);
		const rightEntries = await describeTree(right);
		const differences = [];
		compareTreeEntries(leftEntries, rightEntries, differences, 'expanded-archive');
		await scanForWorkspacePaths(left, forbiddenPaths, differences, 'expanded-build-a');
		await scanForWorkspacePaths(right, forbiddenPaths, differences, 'expanded-build-b');
		return { differences, entryCount: Math.max(leftEntries.size, rightEntries.size) };
	} finally {
		await rm(temporaryRoot, { recursive: true, force: true });
	}
}

function extractArchive(archive, destination) {
	const kind = extension(archive);
	const command = kind === '.tgz' ? ['tar', ['-xzf', archive, '-C', destination]] : ['unzip', ['-qq', archive, '-d', destination]];
	const result = spawnSync(command[0], command[1], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
	if (result.error !== undefined) throw new Error(`Failed to start ${command[0]} for ${archive}: ${result.error.message}`);
	if (result.status !== 0) throw new Error(`Failed to extract ${archive}: ${(result.stderr || result.stdout).trim()}`);
}

async function scanForWorkspacePaths(root, forbiddenPaths, differences, scope) {
	if (forbiddenPaths.length === 0) return;
	const entries = await describeTree(root);
	const needles = forbiddenPaths.flatMap(path => {
		const absolute = resolve(path);
		return [...new Set([absolute, absolute.split(sep).join('/'), `file://${absolute.split(sep).join('/')}`])];
	});
	for (const [path, entry] of entries) {
		if (entry.type !== 'file' || entry.bytes > 64 * 1024 * 1024) continue;
		const bytes = await readFile(resolve(root, path));
		for (const needle of needles) {
			if (bytes.includes(Buffer.from(needle))) {
				differences.push({ kind: 'workspace-path', scope, path, value: needle });
				break;
			}
		}
	}
}

async function writeReport(outputDirectory, report) {
	await mkdir(outputDirectory, { recursive: true });
	await writeFile(resolve(outputDirectory, 'report.json'), `${JSON.stringify(report, null, '\t')}\n`, 'utf8');
	const lines = [
		'# Reproducible release verification',
		'',
		`Result: **${report.passed ? 'PASS' : 'FAIL'}**`,
		'',
		`Independent builds: ${report.builds.length}`,
		`Compared archives: ${report.archives.length}`,
		`Differences: ${report.differences.length}`,
		'',
	];
	if (report.differences.length > 0) {
		lines.push('## Differences', '');
		for (const difference of report.differences) lines.push(`- \`${difference.kind}\` ${difference.archive ?? difference.path ?? difference.message ?? ''}`.trimEnd());
	}
	await writeFile(resolve(outputDirectory, 'summary.md'), `${lines.join('\n')}\n`, 'utf8');
}

function digest(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
function extension(path) { return path.endsWith('.tgz') ? '.tgz' : extname(path).toLowerCase(); }
function octal(mode) { return `0${mode.toString(8).padStart(3, '0')}`; }

const entry = process.argv[1] === undefined ? undefined : resolve(process.argv[1]);
if (entry === fileURLToPath(import.meta.url)) await verifyReproducibleRelease();
