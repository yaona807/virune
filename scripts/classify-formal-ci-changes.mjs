import { spawnSync } from 'node:child_process';
import { appendFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildChangedPathDiffArguments, parseGitChangedPaths } from './classify-ci-changes.mjs';

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));

export const formalLanes = Object.freeze([
	'browser-conformance',
	'performance',
	'fixed-seed',
	'typescript7',
	'vsix',
]);

const sharedClassifierControls = new Set([
	'scripts/classify-ci-changes.mjs',
	'scripts/classify-ci-changes.test.mjs',
	'scripts/classify-formal-ci-changes.mjs',
	'scripts/classify-formal-ci-changes.test.mjs',
	'scripts/verify-formal-ci-gate.mjs',
	'scripts/verify-formal-ci-gate.test.mjs',
]);

const laneMatchers = Object.freeze({
	'browser-conformance': path =>
		path === '.github/workflows/browser-conformance.yml'
		|| path === 'integration/browser.test.ts'
		|| path === 'package.json'
		|| path === 'package-lock.json'
		|| path.startsWith('packages/compiler/')
		|| path.startsWith('packages/runtime/')
		|| path.startsWith('packages/stdlib/'),
	performance: path =>
		path === '.github/workflows/performance.yml'
		|| path === 'docs/performance-benchmarks.md'
		|| path === 'package.json'
		|| path === 'package-lock.json'
		|| path === 'tsconfig.json'
		|| path === 'scripts/benchmark-js-interop-heap.mjs'
		|| path === 'scripts/benchmark-lsp-completion.mjs'
		|| path === 'scripts/check-performance-regression.mjs'
		|| path === 'scripts/performance-benchmark-utils.mjs'
		|| path === 'scripts/performance-regression.test.mjs'
		|| path.startsWith('benchmarks/performance/')
		|| path.startsWith('packages/compiler/')
		|| path.startsWith('packages/js-interop/')
		|| path.startsWith('packages/language-server/'),
	'fixed-seed': path =>
		path === '.github/workflows/selfhost-fixed-seed.yml'
		|| path === 'package-lock.json'
		|| path === 'scripts/run-selfhost-fixed-seed-bootstrap.mjs'
		|| path === 'scripts/run-selfhost-fixed-seed-bootstrap.test.mjs'
		|| path === 'scripts/verify-selfhost-seed.mjs'
		|| path === 'scripts/verify-selfhost-seed.test.mjs'
		|| path.startsWith('.github/self-hosting/')
		|| path.startsWith('packages/compiler/')
		|| path.startsWith('selfhost/mvp/'),
	typescript7: path =>
		path === '.github/typescript-version-policy.json'
		|| path === '.github/workflows/typescript-7-prototype.yml'
		|| path === 'package.json'
		|| path === 'scripts/probe-typescript-7.mjs'
		|| /^docs\/adr-typescript-7-migration[^/]*\.md$/u.test(path)
		|| /^packages\/[^/]+\/(?:package\.json|tsconfig\.json)$/u.test(path)
		|| path.startsWith('packages/js-interop/')
		|| path.startsWith('packages/language-server/')
		|| path.startsWith('packages/vscode/')
		|| /^scripts\/verify-typescript-boundary[^/]*\.mjs$/u.test(path)
		|| /^tsconfig[^/]*\.json$/u.test(path),
	vsix: path =>
		path === '.github/workflows/vsix-smoke.yml'
		|| path === 'package.json'
		|| path === 'package-lock.json'
		|| path === 'scripts/build-vscode.mjs'
		|| path === 'scripts/package-vscode.mjs'
		|| /^scripts\/vsix-smoke[^/]*\.mjs$/u.test(path)
		|| path.startsWith('scripts/vsix-smoke-harness/')
		|| path.startsWith('packages/vscode/')
		|| path.startsWith('packages/language-server/'),
});

export function normalizeChangedPaths(paths) {
	return [...new Set(paths.map(path => path.trim().replaceAll('\\', '/')).filter(Boolean))].sort();
}

export function isFormalLaneRequired(lane, paths) {
	const matcher = laneMatchers[lane];
	if (matcher === undefined) throw new Error(`Unknown formal CI lane: ${lane}`);
	const normalized = normalizeChangedPaths(paths);
	if (normalized.length === 0) return true;
	return normalized.some(path => sharedClassifierControls.has(path) || matcher(path));
}

async function main() {
	const argumentsMap = parseArguments(process.argv.slice(2));
	if (!formalLanes.includes(argumentsMap.lane)) {
		throw new Error(`Provide --lane with one of: ${formalLanes.join(', ')}.`);
	}
	let paths;
	if (argumentsMap.forceFull === true) {
		paths = [];
	} else {
		if (argumentsMap.base === undefined || argumentsMap.head === undefined) {
			throw new Error('Provide --base and --head, or --force-full.');
		}
		const result = spawnSync('git', buildChangedPathDiffArguments(argumentsMap.base, argumentsMap.head), {
			cwd: repositoryRoot,
			encoding: 'utf8',
			maxBuffer: 16 * 1024 * 1024,
		});
		if (result.error !== undefined || result.status !== 0) {
			throw new Error(`Unable to classify formal CI changes: ${result.stderr || result.error?.message}`);
		}
		paths = parseGitChangedPaths(result.stdout);
	}
	const normalized = normalizeChangedPaths(paths);
	const payload = {
		lane: argumentsMap.lane,
		required: isFormalLaneRequired(argumentsMap.lane, normalized),
		changedCount: normalized.length,
		paths: normalized,
	};
	process.stdout.write(`${JSON.stringify(payload, null, '\t')}\n`);
	const outputPath = argumentsMap.githubOutput ?? process.env.GITHUB_OUTPUT;
	if (outputPath !== undefined && outputPath !== '') {
		await appendFile(outputPath, [
			`formal_required=${payload.required}`,
			`changed_count=${payload.changedCount}`,
			`changed_paths=${JSON.stringify(payload.paths)}`,
			'',
		].join('\n'), 'utf8');
	}
}

function parseArguments(argumentsList) {
	const result = { forceFull: false };
	for (let index = 0; index < argumentsList.length; index++) {
		const argument = argumentsList[index];
		if (argument === '--lane') result.lane = argumentsList[++index];
		else if (argument === '--base') result.base = argumentsList[++index];
		else if (argument === '--head') result.head = argumentsList[++index];
		else if (argument === '--github-output') result.githubOutput = argumentsList[++index];
		else if (argument === '--force-full') result.forceFull = true;
		else throw new Error(`Unknown argument: ${argument}`);
	}
	return result;
}

const entry = process.argv[1] === undefined ? undefined : resolve(process.argv[1]);
if (entry === fileURLToPath(import.meta.url)) await main();
