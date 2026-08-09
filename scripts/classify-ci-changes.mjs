import { appendFile, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const documentationFiles = new Set([
	'CODE_OF_CONDUCT.md',
	'CONTRIBUTING.md',
	'README.md',
	'README_ja.md',
	'SECURITY.md',
]);
const documentationDirectories = Object.freeze([
	'.github/PULL_REQUEST_TEMPLATE/',
	'.github/self-hosting-operations/',
	'docs/',
]);
const selfhostInventoryFiles = new Set([
	'.github/actions-policy.json',
	'package.json',
	'package-lock.json',
	'tsconfig.json',
	'tsconfig.base.json',
	'packages/compiler/package.json',
	'packages/compiler/tsconfig.json',
	'packages/runtime/package.json',
	'packages/runtime/tsconfig.json',
	'scripts/classify-ci-changes.mjs',
	'scripts/classify-ci-changes.test.mjs',
]);
const selfhostInventoryDirectories = Object.freeze([
	'.github/workflows/',
	'integration/',
	'packages/compiler/src/',
	'packages/compiler/test/selfhost',
	'packages/runtime/src/',
	'selfhost/',
	'spec/',
]);
const selfhostInventoryScriptPrefixes = Object.freeze([
	'scripts/run-selfhost-',
	'scripts/verify-selfhost-',
]);
const selfhostRequiredGateFiles = new Set([
	'package.json',
	'package-lock.json',
	'tsconfig.json',
	'tsconfig.base.json',
	'packages/compiler/package.json',
	'packages/compiler/tsconfig.json',
	'packages/runtime/package.json',
	'packages/runtime/tsconfig.json',
	'scripts/classify-ci-changes.mjs',
	'scripts/classify-ci-changes.test.mjs',
]);
const selfhostRequiredGateDirectories = Object.freeze([
	'.github/self-hosting/',
	'packages/compiler/src/selfhost/',
	'packages/compiler/test/selfhost',
	'packages/runtime/src/',
	'selfhost/',
]);

export function classifyChangedPaths(paths) {
	const normalized = [...new Set(paths.map(path => path.trim().replaceAll('\\', '/')).filter(Boolean))].sort();
	const documentationOnly = normalized.length > 0 && normalized.every(isDocumentationPath);
	const selfhostInventoryRequired = normalized.length === 0
		|| normalized.some(isSelfhostInventoryPath);
	const selfhostRequiredGateRequired = normalized.length === 0
		|| normalized.some(isSelfhostRequiredGatePath);
	return {
		docsOnly: documentationOnly,
		selfhostInventoryRequired,
		selfhostRequiredGateRequired,
		changedCount: normalized.length,
		paths: normalized,
	};
}

export function isDocumentationPath(path) {
	return documentationFiles.has(path)
		|| (path.endsWith('.md') && documentationDirectories.some(directory => path.startsWith(directory)));
}

export function isSelfhostInventoryPath(path) {
	return selfhostInventoryFiles.has(path)
		|| selfhostInventoryDirectories.some(directory => path.startsWith(directory))
		|| selfhostInventoryScriptPrefixes.some(prefix => path.startsWith(prefix));
}

export function isSelfhostRequiredGatePath(path) {
	return selfhostRequiredGateFiles.has(path)
		|| selfhostRequiredGateDirectories.some(directory => path.startsWith(directory))
		|| path === '.github/workflows/nightly.yml'
		|| path.startsWith('.github/workflows/selfhost-')
		|| (path.startsWith('scripts/') && path.includes('selfhost'));
}

async function main() {
	const argumentsMap = parseArguments(process.argv.slice(2));
	let classification;
	if (argumentsMap.forceFull === true) {
		classification = classifyChangedPaths([]);
	} else if (argumentsMap.pathsFile !== undefined) {
		classification = classifyChangedPaths((await readFile(argumentsMap.pathsFile, 'utf8')).split(/\r?\n/u));
	} else {
		if (argumentsMap.base === undefined || argumentsMap.head === undefined) {
			throw new Error('Provide --base and --head, --paths-file, or --force-full.');
		}
		const result = spawnSync('git', ['diff', '--name-only', '--diff-filter=ACMR', `${argumentsMap.base}...${argumentsMap.head}`], {
			cwd: repositoryRoot,
			encoding: 'utf8',
			maxBuffer: 16 * 1024 * 1024,
		});
		if (result.error !== undefined || result.status !== 0) {
			throw new Error(`Unable to classify changed files: ${result.stderr || result.error?.message}`);
		}
		classification = classifyChangedPaths(result.stdout.split(/\r?\n/u));
	}

	const payload = `${JSON.stringify(classification, null, '\t')}\n`;
	process.stdout.write(payload);
	const outputPath = argumentsMap.githubOutput ?? process.env.GITHUB_OUTPUT;
	if (outputPath !== undefined && outputPath !== '') {
		await appendFile(outputPath, [
			`docs_only=${classification.docsOnly}`,
			`selfhost_inventory_required=${classification.selfhostInventoryRequired}`,
			`selfhost_required_gate_required=${classification.selfhostRequiredGateRequired}`,
			`changed_count=${classification.changedCount}`,
			`changed_paths=${JSON.stringify(classification.paths)}`,
			'',
		].join('\n'), 'utf8');
	}
}

function parseArguments(argumentsList) {
	const result = { forceFull: false };
	for (let index = 0; index < argumentsList.length; index++) {
		const argument = argumentsList[index];
		if (argument === '--force-full') result.forceFull = true;
		else if (argument === '--base') result.base = argumentsList[++index];
		else if (argument === '--head') result.head = argumentsList[++index];
		else if (argument === '--paths-file') result.pathsFile = argumentsList[++index];
		else if (argument === '--github-output') result.githubOutput = argumentsList[++index];
		else throw new Error(`Unknown argument: ${argument}`);
	}
	return result;
}

const entry = process.argv[1] === undefined ? undefined : resolve(process.argv[1]);
if (entry === fileURLToPath(import.meta.url)) await main();
