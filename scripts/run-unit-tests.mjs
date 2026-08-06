import { spawn } from 'node:child_process';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { dirname, join } from 'node:path';

const filter = process.argv.find(item => item.startsWith('--filter='))?.slice('--filter='.length);
const exactFile = process.argv.find(item => item.startsWith('--file='))?.slice('--file='.length);
const excludedFiles = process.argv
	.filter(item => item.startsWith('--exclude-file='))
	.map(item => item.slice('--exclude-file='.length));
const failureOutputOnly = process.argv.includes('--failure-output-only');
const timingOutputArgument = process.argv.find(item => item.startsWith('--timing-output='));
const timingOutput = timingOutputArgument?.slice('--timing-output='.length)
	?? '.cache/ci-timings/unit-test-files.json';
if (filter !== undefined && exactFile !== undefined) {
	console.error('Specify at most one of --filter or --file.');
	process.exit(1);
}
if (exactFile !== undefined && excludedFiles.length > 0) {
	console.error('Do not combine --file with --exclude-file.');
	process.exit(1);
}
if (excludedFiles.some(value => value.length === 0)) {
	console.error('--exclude-file requires a non-empty compiled test path.');
	process.exit(1);
}
if (timingOutput.length === 0) {
	console.error('--timing-output requires a non-empty path.');
	process.exit(1);
}
const files = [];
for (const entry of await readdir('packages', { withFileTypes: true })) {
	if (!entry.isDirectory()) continue;
	await collectTests(join('packages', entry.name, 'dist', 'test'), files);
}
files.sort();
if (filter !== undefined) {
	for (let index = files.length - 1; index >= 0; index -= 1) {
		if (!canonicalPath(files[index]).includes(canonicalPath(filter))) files.splice(index, 1);
	}
}
if (exactFile !== undefined) {
	for (let index = files.length - 1; index >= 0; index -= 1) {
		if (canonicalPath(files[index]) !== canonicalPath(exactFile)) files.splice(index, 1);
	}
} else if (excludedFiles.length > 0) {
	const excluded = new Set(excludedFiles.map(canonicalPath));
	for (let index = files.length - 1; index >= 0; index -= 1) {
		if (excluded.has(canonicalPath(files[index]))) files.splice(index, 1);
	}
}
if (files.length === 0) {
	console.error(exactFile === undefined
		? 'No compiled unit test files remained after applying the requested selection. Run npm run build first and verify the filters.'
		: `Compiled unit test file was not found: ${exactFile}`);
	process.exit(1);
}

const suiteStartedAt = new Date().toISOString();
const suiteStarted = performance.now();
const fileTimings = [];
let failedResult;

// TypeScript-heavy test files are run in isolated processes. This avoids cumulative
// compiler memory and Node test-worker cancellation while preserving exact failures.
for (const file of files) {
	if (!failureOutputOnly) console.log(`\n--- ${file} ---`);
	const fileStarted = performance.now();
	let result;
	try {
		result = await runNodeTest(file, failureOutputOnly);
	} catch (error) {
		fileTimings.push({
			path: canonicalPath(file),
			status: 'error',
			exitCode: null,
			durationMs: elapsedMilliseconds(fileStarted),
			error: error instanceof Error ? error.message : String(error),
		});
		await writeTimingEvidence('failed');
		throw error;
	}
	fileTimings.push({
		path: canonicalPath(file),
		status: result.code === 0 ? 'passed' : 'failed',
		exitCode: result.code,
		durationMs: elapsedMilliseconds(fileStarted),
	});
	if (result.code === 0) continue;
	if (failureOutputOnly) {
		const header = Buffer.from(`--- ${file} ---\n`);
		const diagnostic = Buffer.concat([header, result.stdout, result.stderr]);
		await mkdir('.cache', { recursive: true });
		await writeFile('.cache/unit-test-failure.log', diagnostic);
		process.stderr.write(`\n--- ${file} ---\n`);
		if (result.stdout.length > 0) process.stdout.write(result.stdout);
		if (result.stderr.length > 0) process.stderr.write(result.stderr);
	}
	failedResult = result;
	break;
}

await writeTimingEvidence(failedResult === undefined ? 'passed' : 'failed');
if (failedResult !== undefined) process.exit(failedResult.code);

function canonicalPath(value) {
	return value.replaceAll('\\', '/');
}

function elapsedMilliseconds(startedAt) {
	return Number((performance.now() - startedAt).toFixed(3));
}

async function writeTimingEvidence(status) {
	const evidence = {
		schemaVersion: 1,
		claim: 'unit-test-file-timings',
		status,
		startedAt: suiteStartedAt,
		selectedFileCount: files.length,
		completedFileCount: fileTimings.length,
		remainingFileCount: files.length - fileTimings.length,
		totalDurationMs: elapsedMilliseconds(suiteStarted),
		files: fileTimings,
	};
	await mkdir(dirname(timingOutput), { recursive: true });
	await writeFile(timingOutput, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
}

async function collectTests(directory, output) {
	let entries;
	try {
		entries = await readdir(directory, { withFileTypes: true });
	} catch (error) {
		if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return;
		throw error;
	}
	for (const entry of entries) {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) await collectTests(path, output);
		else if (entry.isFile() && entry.name.endsWith('.test.js')) output.push(path);
	}
}

function runNodeTest(file, captureOutput) {
	const { NODE_TEST_CONTEXT: _ignored, ...env } = process.env;
	return new Promise((resolve, reject) => {
		const child = spawn(process.execPath, ['--test', '--test-isolation=none', '--test-timeout=120000', file], {
			cwd: process.cwd(),
			env,
			stdio: captureOutput ? ['inherit', 'pipe', 'pipe'] : 'inherit',
		});
		const stdout = [];
		const stderr = [];
		if (captureOutput) {
			child.stdout.on('data', chunk => stdout.push(chunk));
			child.stderr.on('data', chunk => stderr.push(chunk));
		}
		child.once('error', reject);
		child.once('exit', code => resolve({
			code: code ?? 1,
			stdout: Buffer.concat(stdout),
			stderr: Buffer.concat(stderr),
		}));
	});
}
