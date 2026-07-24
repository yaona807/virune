import { spawn } from 'node:child_process';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const filter = process.argv.find(item => item.startsWith('--filter='))?.slice('--filter='.length);
const failureOutputOnly = process.argv.includes('--failure-output-only');
const files = [];
for (const entry of await readdir('packages', { withFileTypes: true })) {
	if (!entry.isDirectory()) continue;
	await collectTests(join('packages', entry.name, 'dist', 'test'), files);
}
files.sort();
if (filter !== undefined) {
	for (let index = files.length - 1; index >= 0; index -= 1) if (!files[index].includes(filter)) files.splice(index, 1);
}
if (files.length === 0) {
	console.error('No compiled unit test files were found. Run npm run build first.');
	process.exit(1);
}
// TypeScript-heavy test files are run in isolated processes. This avoids cumulative
// compiler memory and Node test-worker cancellation while preserving exact failures.
for (const file of files) {
	if (!failureOutputOnly) console.log(`\n--- ${file} ---`);
	const result = await runNodeTest(file, failureOutputOnly);
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
	process.exit(result.code);
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
