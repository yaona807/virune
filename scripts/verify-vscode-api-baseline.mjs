import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const EXACT_VERSION = /^(\d+)\.(\d+)\.(\d+)$/u;
const MINIMUM_ENGINE = /^>=\s*(\d+)\.(\d+)\.(\d+)$/u;

export async function verifyVscodeApiBaseline(root = process.cwd()) {
	const packagePath = resolve(root, 'packages/vscode/package.json');
	const packageJson = JSON.parse(await readFile(packagePath, 'utf8'));
	validateVscodeApiBaseline(packageJson);
	console.log(`Verified VS Code API baseline ${packageJson.devDependencies['@types/vscode']} against ${packageJson.engines.vscode}.`);
}

export function validateVscodeApiBaseline(packageJson) {
	const engineRange = packageJson?.engines?.vscode;
	const typesVersion = packageJson?.devDependencies?.['@types/vscode'];
	if (typeof engineRange !== 'string') throw new Error('packages/vscode/package.json must declare engines.vscode.');
	if (typeof typesVersion !== 'string') throw new Error('packages/vscode/package.json must declare devDependencies["@types/vscode"].');

	const engine = parseVersion(engineRange, MINIMUM_ENGINE, 'engines.vscode must use an explicit >=x.y.z minimum');
	const types = parseVersion(typesVersion, EXACT_VERSION, '@types/vscode must be pinned to an exact x.y.z version');
	if (engine.major !== types.major || engine.minor !== types.minor) {
		throw new Error(`@types/vscode ${typesVersion} exceeds the supported VS Code API baseline ${engineRange}; major.minor versions must match.`);
	}
	return { engine, types };
}

function parseVersion(value, pattern, message) {
	const match = pattern.exec(value);
	if (match === null) throw new Error(`${message}: ${value}`);
	return {
		major: Number.parseInt(match[1], 10),
		minor: Number.parseInt(match[2], 10),
		patch: Number.parseInt(match[3], 10),
	};
}

const entry = process.argv[1] === undefined ? undefined : resolve(process.argv[1]);
if (entry === fileURLToPath(import.meta.url)) await verifyVscodeApiBaseline(resolve(process.argv[2] ?? '.'));
