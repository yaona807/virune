import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const defaultOutput = '.cache/selfhost/full-language-inventory.json';
const defaultTimingOutput = '.cache/selfhost/full-language-inventory-timings.json';

export function parseArguments(argumentsList) {
	let json = false;
	let help = false;
	let output = defaultOutput;
	let timingOutput = defaultTimingOutput;
	let outputSeen = false;
	let timingOutputSeen = false;
	for (const argument of argumentsList) {
		if (argument === '--json') {
			if (json) throw new Error('Duplicate option: --json');
			json = true;
		} else if (argument === '--help') {
			if (help) throw new Error('Duplicate option: --help');
			help = true;
		} else if (argument.startsWith('--output=')) {
			if (outputSeen) throw new Error('Duplicate option: --output');
			output = nonEmpty(argument.slice('--output='.length), '--output');
			outputSeen = true;
		} else if (argument.startsWith('--timing-output=')) {
			if (timingOutputSeen) throw new Error('Duplicate option: --timing-output');
			timingOutput = nonEmpty(argument.slice('--timing-output='.length), '--timing-output');
			timingOutputSeen = true;
		} else {
			throw new Error(`Unknown argument: ${argument}`);
		}
	}
	if (help && (json || outputSeen || timingOutputSeen)) {
		throw new Error('--help cannot be combined with other options');
	}
	return { json, help, output, timingOutput };
}

export function resolveRepositoryOutput(repositoryRoot, output, option = '--output') {
	if (isAbsolute(output)) throw new Error(`${option} must be repository-relative`);
	const outputPath = resolve(repositoryRoot, output);
	const repositoryRelative = relative(repositoryRoot, outputPath);
	if (
		repositoryRelative === ''
		|| repositoryRelative === '..'
		|| repositoryRelative.startsWith(`..${sep}`)
		|| isAbsolute(repositoryRelative)
	) {
		throw new Error(`${option} must stay inside the repository`);
	}
	if (!(repositoryRelative === '.cache' || repositoryRelative.startsWith(`.cache${sep}`))) {
		throw new Error(`${option} must be inside .cache`);
	}
	if (!repositoryRelative.endsWith('.json')) throw new Error(`${option} must end in .json`);
	return { outputPath, repositoryRelative };
}

export function helpText() {
	return [
		'Usage: npm run selfhost:inventory -- [--json] [--output=<repository-relative.json>] [--timing-output=<repository-relative.json>]',
		'',
		'Runs the canonical full-language self-host inventory.',
		'Writes phase timing evidence on success and failure.',
		'Progress and 60-second heartbeats are written to stderr.',
		'Incomplete language lowering is reported with exit code 0.',
		'Boundary regressions, non-determinism, build failures, and invalid output paths fail.',
	].join('\n');
}

export async function main(argumentsList = process.argv.slice(2)) {
	const options = parseArguments(argumentsList);
	if (options.help) {
		console.log(helpText());
		return;
	}
	const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
	const output = resolveRepositoryOutput(repositoryRoot, options.output, '--output');
	const timingOutput = resolveRepositoryOutput(
		repositoryRoot,
		options.timingOutput,
		'--timing-output',
	);
	if (output.outputPath === timingOutput.outputPath) {
		throw new Error('--output and --timing-output must refer to different files');
	}
	const [runnerModule, inventoryModule] = await Promise.all([
		import('../packages/compiler/dist/src/selfhost/full-language-inventory-runner.js'),
		import('../packages/compiler/dist/src/selfhost/full-language-inventory.js'),
	]);
	const inventory = await runnerModule.runFullLanguageInventory({
		repositoryRoot,
		onProgress: event => {
			console.error(runnerModule.formatFullLanguageInventoryProgress(event));
		},
		onTimingEvidence: async evidence => {
			await mkdir(dirname(timingOutput.outputPath), { recursive: true });
			await writeFile(
				timingOutput.outputPath,
				runnerModule.serializeFullLanguageInventoryTimingEvidence(evidence),
				'utf8',
			);
		},
	});
	const encoded = inventoryModule.serializeFullLanguageInventory(inventory);
	await mkdir(dirname(output.outputPath), { recursive: true });
	await writeFile(output.outputPath, encoded, 'utf8');
	if (options.json) {
		process.stdout.write(encoded);
		return;
	}
	for (const line of inventoryModule.formatFullLanguageInventorySummary(inventory)) console.log(line);
	console.log(`JSON: ${output.repositoryRelative}`);
	console.log(`Timing JSON: ${timingOutput.repositoryRelative}`);
}

function nonEmpty(value, option) {
	if (typeof value !== 'string' || value.trim() === '') throw new Error(`${option} must be a non-empty string`);
	return value.trim();
}

const directExecution = process.argv[1] !== undefined
	&& import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (directExecution) {
	try {
		await main();
	} catch (error) {
		console.error(`SELFHOST_INVENTORY_ERROR ${error instanceof Error ? error.message : String(error)}`);
		process.exitCode = 1;
	}
}
