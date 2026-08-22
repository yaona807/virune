#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { parseInitOptions, type InitDependencySource } from './init-options.js';

const directory = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(directory, '../..');
const manifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8')) as { version: string };
const version = manifest.version;
const releaseSourceBase = `https://github.com/yaona807/virune/blob/v${version}`;
const latestApplicationGuide = 'https://github.com/yaona807/virune/blob/main/docs/application-guide.md';
const commandArgs = process.argv.slice(2);
const initOptions = commandArgs[0] === 'init' ? parseInitOptions(commandArgs.slice(1)) : undefined;
const initRoot = initOptions === undefined ? undefined : resolve(initOptions.projectPath);
const packageJsonExisted = initRoot === undefined ? false : await pathExists(join(initRoot, 'package.json'));
const exitCode = await runMain(commandArgs);

if (exitCode === 0 && initOptions !== undefined && initRoot !== undefined) {
	await completeInitialization(initRoot, initOptions.dependencySource, packageJsonExisted);
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

async function completeInitialization(root: string, dependencySource: InitDependencySource, preservedPackageJson: boolean): Promise<void> {
	await writeFile(join(root, 'README.md'), projectReadme(basename(root), dependencySource, preservedPackageJson), { flag: 'wx' }).catch(ignoreExisting);
	console.log(`\nNext steps:\n  cd ${JSON.stringify(root)}\n  npm install\n  npm run check\n  npm run start`);
	console.log(`\nGuide: ${releaseSourceBase}/README.md#quick-start`);
}

function projectReadme(name: string, dependencySource: InitDependencySource, preservedPackageJson: boolean): string {
	const dependencyDescription = preservedPackageJson
		? `Virune init preserved the existing package.json. The requested dependency source was ${dependencySource}, but existing dependency declarations were not rewritten; review package.json before installing dependencies.`
		: dependencySource === 'npm'
			? `The CLI, Runtime, and standard library use exact Virune ${version} package versions intended for the public npm Registry. No mutable npm range or dist-tag is used.`
			: `The CLI, Runtime, and standard library are pinned to immutable Virune ${version} GitHub Release assets rather than npm Registry packages so the generated project uses one verified toolchain release.`;
	return `# ${name}\n\nGenerated with Virune ${version}.\n\n## Quick start\n\n\`\`\`bash\nnpm install\nnpm run check\nnpm test\nnpm run start\n\`\`\`\n\nUse \`npm run fmt\` to format Virune source and \`npm run build\` to emit ES2022 modules.\n\n## Project structure\n\n- \`src/main.virune\` — application entry point\n- \`virune.json\` — compiler and platform configuration\n- \`package.json\` — project scripts and version-pinned Virune dependencies\n\nThis project starts with the Node.js target. ${dependencyDescription}\n\n## Documentation\n\n- [Quick start](${releaseSourceBase}/README.md#quick-start)\n- [Application guide (latest)](${latestApplicationGuide})\n- [Language guide](${releaseSourceBase}/docs/language-guide.md)\n- [Node.js and browser standard library](${releaseSourceBase}/docs/standard-library.md)\n- [JavaScript and TypeScript interoperability](${releaseSourceBase}/docs/js-interop.md)\n`;
}

async function pathExists(path: string): Promise<boolean> {
	try {
		await stat(path);
		return true;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
		throw error;
	}
}

function ignoreExisting(error: unknown): void {
	if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
}
