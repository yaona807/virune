#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
	matchesGeneratedProjectPackageManifest,
	parseInitOptions,
	type InitDependencySource,
} from './init-options.js';

const directory = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(directory, '../..');
const manifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8')) as { version: string };
const version = manifest.version;
const releaseSourceBase = `https://github.com/yaona807/virune/blob/v${version}`;
const latestApplicationGuide = 'https://github.com/yaona807/virune/blob/main/docs/application-guide.md';
const commandArgs = process.argv.slice(2);
const exitCode = await runMain(commandArgs);

if (exitCode === 0 && commandArgs[0] === 'init') {
	const initOptions = parseInitOptions(commandArgs.slice(1));
	const initRoot = resolve(initOptions.projectPath);
	const canonicalGeneratedManifest = await packageJsonMatchesRequestedSource(initRoot, initOptions.dependencySource);
	await completeInitialization(initRoot, initOptions.dependencySource, canonicalGeneratedManifest);
}
process.exitCode = exitCode;

function runMain(args: readonly string[]): Promise<number> {
	const { NODE_TEST_CONTEXT: _nodeTestContext, ...env } = process.env;
	return new Promise((resolvePromise, reject) => {
		const child = spawn(process.execPath, [join(directory, 'main.js'), ...args], { stdio: 'inherit', env });
		child.once('error', reject);
		child.once('exit', code => resolvePromise(code ?? 1));
	});
}

async function packageJsonMatchesRequestedSource(root: string, dependencySource: InitDependencySource): Promise<boolean> {
	try {
		const value = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as unknown;
		return matchesGeneratedProjectPackageManifest(value, basename(root), version, dependencySource);
	} catch {
		return false;
	}
}

async function completeInitialization(root: string, dependencySource: InitDependencySource, canonicalGeneratedManifest: boolean): Promise<void> {
	await writeFile(join(root, 'README.md'), projectReadme(basename(root), dependencySource, canonicalGeneratedManifest), { flag: 'wx' }).catch(ignoreExisting);
	console.log(`\nNext steps:\n  cd ${JSON.stringify(root)}\n  npm install\n  npm run check\n  npm run start`);
	console.log(`\nGuide: ${releaseSourceBase}/README.md#quick-start`);
}

function projectReadme(name: string, dependencySource: InitDependencySource, canonicalGeneratedManifest: boolean): string {
	const dependencyDescription = !canonicalGeneratedManifest
		? `Virune init preserved the existing package.json or its contents changed during initialization. The requested dependency source was ${dependencySource}, but dependency declarations were not rewritten to the canonical generated-project model; review package.json before installing dependencies.`
		: dependencySource === 'npm'
			? `The CLI, Runtime, and standard library use exact Virune ${version} package versions intended for the public npm Registry. No mutable npm range or dist-tag is used.`
			: `The CLI, Runtime, and standard library are pinned to immutable Virune ${version} GitHub Release assets rather than npm Registry packages so the generated project uses one verified toolchain release.`;
	return `# ${name}\n\nGenerated with Virune ${version}.\n\n## Quick start\n\n\`\`\`bash\nnpm install\nnpm run check\nnpm test\nnpm run start\n\`\`\`\n\nUse \`npm run fmt\` to format Virune source and \`npm run build\` to emit ES2022 modules.\n\n## Project structure\n\n- \`src/main.virune\` — application entry point\n- \`virune.json\` — compiler and platform configuration\n- \`package.json\` — project scripts and version-pinned Virune dependencies\n\nThis project starts with the Node.js target. ${dependencyDescription}\n\n## Documentation\n\n- [Quick start](${releaseSourceBase}/README.md#quick-start)\n- [Application guide (latest)](${latestApplicationGuide})\n- [Language guide](${releaseSourceBase}/docs/language-guide.md)\n- [Node.js and browser standard library](${releaseSourceBase}/docs/standard-library.md)\n- [JavaScript and TypeScript interoperability](${releaseSourceBase}/docs/js-interop.md)\n`;
}

function ignoreExisting(error: unknown): void {
	if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
}
