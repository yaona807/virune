import { spawnSync } from 'node:child_process';
import { appendFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	buildChangedPathDiffArguments,
	isDocumentationPath,
	parseGitChangedPaths,
} from './classify-ci-changes.mjs';

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));

export const formalLanes = Object.freeze([
	'browser-conformance',
	'performance',
	'fixed-seed',
	'typescript7',
	'vsix',
]);

const reviewedRequiredDocumentation = Object.freeze({
	'browser-conformance': () => false,
	performance: path => path === 'docs/performance-benchmarks.md',
	'fixed-seed': () => false,
	typescript7: path => /^docs\/adr-typescript-7-migration[^/]*\.md$/u.test(path),
	vsix: () => false,
});

export function normalizeChangedPaths(paths) {
	return [...new Set(paths.filter(path => path.length > 0))].sort();
}

export function isFormalLaneRequired(lane, paths) {
	const documentationRequiresLane = reviewedRequiredDocumentation[lane];
	if (documentationRequiresLane === undefined) throw new Error(`Unknown formal CI lane: ${lane}`);
	const normalized = normalizeChangedPaths(paths);
	if (normalized.length === 0) return true;
	if (normalized.some(documentationRequiresLane)) return true;
	return !normalized.every(isDocumentationPath);
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
