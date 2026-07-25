import { appendFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));

export async function writeCiSummary({ root = repositoryRoot, summaryPath = process.env.GITHUB_STEP_SUMMARY } = {}) {
	const timingDirectory = resolve(root, '.cache/ci-timings');
	const failureDirectory = resolve(root, '.cache/ci-failures');
	const records = await readJsonLines(timingDirectory);
	const failures = await readMarkdownFiles(failureDirectory);
	const markdown = renderCiSummary(records, failures);
	await mkdir(timingDirectory, { recursive: true });
	await writeFile(resolve(timingDirectory, 'summary.json'), `${JSON.stringify({ schemaVersion: 1, records, failures: failures.map(item => item.path) }, null, '\t')}\n`, 'utf8');
	if (summaryPath !== undefined && summaryPath !== '') await appendFile(summaryPath, markdown, 'utf8');
	else process.stdout.write(markdown);
	return { records, failures, markdown };
}

export function renderCiSummary(records, failures = []) {
	const ordered = [...records].sort((left, right) => right.durationMs - left.durationMs || left.id.localeCompare(right.id));
	const total = ordered.reduce((sum, item) => sum + item.durationMs, 0);
	const lines = [
		'## CI command timings',
		'',
		`Recorded commands: ${ordered.length}  `,
		`Total measured command time: ${formatDuration(total)}`,
		'',
		'| Command | Duration | Status | Local reproduction |',
		'|---|---:|---:|---|',
		...ordered.map(item => `| \`${escapeCell(item.id)}\` | ${formatDuration(item.durationMs)} | ${item.status === 0 ? 'pass' : `fail (${item.status})`} | \`${escapeCell(item.reproduce)}\` |`),
	];
	if (failures.length > 0) {
		lines.push('', '## Failure diagnostics', '');
		for (const failure of failures) lines.push(`- \`${failure.path}\``);
	}
	lines.push('');
	return `${lines.join('\n')}\n`;
}

function formatDuration(milliseconds) {
	if (milliseconds < 1000) return `${milliseconds} ms`;
	return `${(milliseconds / 1000).toFixed(milliseconds < 10_000 ? 2 : 1)} s`;
}

function escapeCell(value) {
	return String(value).replaceAll('|', '\\|').replaceAll('`', '\\`').replaceAll('\n', ' ');
}

async function readJsonLines(directory) {
	const records = [];
	for (const name of await safeReadDirectory(directory)) {
		if (!name.endsWith('.jsonl')) continue;
		const text = await readFile(resolve(directory, name), 'utf8');
		for (const line of text.split(/\r?\n/u).filter(Boolean)) records.push(JSON.parse(line));
	}
	return records;
}

async function readMarkdownFiles(directory) {
	const files = [];
	for (const name of await safeReadDirectory(directory)) {
		if (!name.endsWith('.md')) continue;
		files.push({ path: `.cache/ci-failures/${name}`, content: await readFile(resolve(directory, name), 'utf8') });
	}
	return files;
}

async function safeReadDirectory(directory) {
	try {
		return (await readdir(directory)).sort();
	} catch (error) {
		if (error?.code === 'ENOENT') return [];
		throw error;
	}
}

const entry = process.argv[1] === undefined ? undefined : resolve(process.argv[1]);
if (entry === fileURLToPath(import.meta.url)) await writeCiSummary();
