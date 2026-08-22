#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
	NPM_GENERATED_PROJECT_CAPABILITY_FILE,
	buildGeneratedProjectPackageManifest,
	parseInitOptions,
	validateNpmGeneratedProjectCapability,
	type InitDependencySource,
} from './init-options.js';

const VERSION = '1.0.0';
const directory = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const command = args[0] ?? 'help';

if (command === 'init') {
	try {
		const options = parseInitOptions(args.slice(1));
		await initProject(resolve(options.projectPath), options.dependencySource);
	} catch (error) {
		console.error(error instanceof Error ? error.stack ?? error.message : String(error));
		process.exitCode = 3;
	}
} else {
	await import('./main-core.js');
	if (command === 'help' || command === '--help' || command === '-h') {
		console.log('\nInit options:\n  --dependency-source=github-release|npm   Select immutable GitHub Release assets or exact public npm package versions\n                                       npm requires a reviewed Registry CLI artifact');
	}
}

async function initProject(root: string, dependencySource: InitDependencySource): Promise<void> {
	if (dependencySource === 'npm') await requireNpmGeneratedProjectCapability();
	await mkdir(join(root, 'src'), { recursive: true });
	await writeFile(join(root, 'virune.json'), JSON.stringify({ languageVersion: '1.0', platform: 'node', sourceDir: 'src', outDir: 'dist', entry: 'src/main.virune', target: 'es2022', sourceMap: true, sourcesContent: true }, null, 2) + '\n', { flag: 'wx' }).catch(ignoreExisting);
	await writeFile(join(root, 'src/main.virune'), 'pub fn main() -> Unit uses Console {\n\tConsole.print("Hello from Virune")\n\treturn Unit\n}\n', { flag: 'wx' }).catch(ignoreExisting);
	const manifest = buildGeneratedProjectPackageManifest(basename(root), VERSION, dependencySource);
	await writeFile(join(root, 'package.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' }).catch(ignoreExisting);
	console.log(`Initialized Virune project in ${root}`);
}

async function requireNpmGeneratedProjectCapability(): Promise<void> {
	const capabilityPath = join(directory, NPM_GENERATED_PROJECT_CAPABILITY_FILE);
	let text: string;
	try {
		text = await readFile(capabilityPath, 'utf8');
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
			throw new Error('This Virune CLI artifact is not authorized to generate projects that depend on the public npm Registry.');
		}
		throw error;
	}
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch (error) {
		throw new Error(`Invalid npm generated-project capability JSON: ${error instanceof Error ? error.message : String(error)}`);
	}
	validateNpmGeneratedProjectCapability(value, VERSION);
}

function ignoreExisting(error: unknown): void {
	if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
}
