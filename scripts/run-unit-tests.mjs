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
const concurrencyArguments = process.argv.filter(item => item.startsWith('--concurrency='));
if (concurrencyArguments.length > 1) {
	console.error('Specify --concurrency at most once.');
	process.exit(1);
}
const concurrencyText = concurrencyArguments[0]?.slice('--concurrency='.length) ?? '1';
const concurrency = Number(concurrencyText);
if (!/^[1-9]\d*$/u.test(concurrencyText) || !Number.isSafeInteger(concurrency) || concurrency > 4) {
	console.error('--concurrency requires an integer from 1 through 4.');
	process.exit(1);
}
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
const results = new Array(files.length);
const effectiveConcurrency = Math.min(concurrency, files.length);
let peakConcurrency = 0;
let activeCount = 0;
let nextIndex = 0;
let stopScheduling = false;

await Promise.all(Array.from({ length: effectiveConcurrency }, runWorker));

const completed = results.filter(result => result !== undefined);
const fileTimings = completed.map(result => result.timing);
const failedResult = completed.find(result => result.timing.status !== 'passed');
await writeTimingEvidence(failedResult === undefined ? 'passed' : 'failed', fileTimings);
if (failedResult !== undefined) {
	if (failureOutputOnly && failedResult.result !== undefined) {
		const header = Buffer.from(`--- ${failedResult.file} ---\n`);
		const diagnostic = Buffer.concat([header, failedResult.result.stdout, failedResult.result.stderr]);
		await mkdir('.cache', { recursive: true });
		await writeFile('.cache/unit-test-failure.log', diagnostic);
		process.stderr.write(`\n--- ${failedResult.file} ---\n`);
		if (failedResult.result.stdout.length > 0) process.stdout.write(failedResult.result.stdout);
		if (failedResult.result.stderr.length > 0) process.stderr.write(failedResult.result.stderr);
	}
	if (failedResult.error !== undefined) throw failedResult.error;
	process.exit(failedResult.result?.code ?? 1);
}

async function runWorker() {
	while (!stopScheduling) {
		const index = nextIndex;
		if (index >= files.length) return;
		nextIndex += 1;
		const file = files[index];
		if (!failureOutputOnly) console.log(`\n--- ${file} ---`);
		const fileStarted = performance.now();
		activeCount += 1;
		peakConcurrency = Math.max(peakConcurrency, activeCount);
		try {
			const result = await runNodeTest(file, failureOutputOnly);
			results[index] = {
				file,
				result,
				timing: {
					path: canonicalPath(file),
					status: result.code === 0 ? 'passed' : 'failed',
					exitCode: result.code,
					durationMs: elapsedMilliseconds(fileStarted),
				},
			};
			if (result.code !== 0) stopScheduling = true;
		} catch (error) {
			results[index] = {
				file,
				error,
				timing: {
					path: canonicalPath(file),
					status: 'error',
					exitCode: null,
					durationMs: elapsedMilliseconds(fileStarted),
					error: error instanceof Error ? error.message : String(error),
				},
			};
			stopScheduling = true;
		} finally {
			activeCount -= 1;
		}
	}
}

function canonicalPath(value) {
	return value.replaceAll('\\', '/');
}

function elapsedMilliseconds(startedAt) {
	return Number((performance.now() - startedAt).toFixed(3));
}

async function writeTimingEvidence(status, fileTimings) {
	const evidence = {
		schemaVersion: 1,
		claim: 'unit-test-file-timings',
		status,
		startedAt: suiteStartedAt,
		requestedConcurrency: concurrency,
		effectiveConcurrency,
		peakConcurrency,
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
