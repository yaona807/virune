import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MINIMUM_RUNTIME_MAJOR = 24;
const MINIMUM_ENGINE = /^>=\s*(\d+)\.(\d+)\.(\d+)$/u;
const TYPES_VERSION = /^(?:\^|~)?(\d+)\.(\d+)\.(\d+)$/u;
const PACKAGE_PATHS = ['package.json', 'packages/js-interop/package.json'];

export async function verifyNodeRuntime(root = process.cwd(), runtimeVersion = process.versions.node) {
	const runtimeMajor = Number.parseInt(runtimeVersion.split('.')[0] ?? '', 10);
	if (!Number.isInteger(runtimeMajor) || runtimeMajor < MINIMUM_RUNTIME_MAJOR) {
		throw new Error(`Virune requires Node.js ${MINIMUM_RUNTIME_MAJOR} or newer; received ${runtimeVersion}.`);
	}

	for (const packagePath of PACKAGE_PATHS) {
		const packageJson = JSON.parse(await readFile(resolve(root, packagePath), 'utf8'));
		validateNodeApiBaseline(packageJson, packagePath);
	}

	console.log(`Verified Node.js runtime ${runtimeVersion} and Node API baselines (minimum ${MINIMUM_RUNTIME_MAJOR}).`);
}

export function validateNodeApiBaseline(packageJson, packagePath = 'package.json') {
	const engineRange = packageJson?.engines?.node;
	const dependencyVersion = packageJson?.dependencies?.['@types/node'];
	const devDependencyVersion = packageJson?.devDependencies?.['@types/node'];
	const declaredVersions = [dependencyVersion, devDependencyVersion].filter((value) => typeof value === 'string');

	if (typeof engineRange !== 'string') throw new Error(`${packagePath} must declare engines.node.`);
	if (declaredVersions.length === 0) throw new Error(`${packagePath} must declare @types/node.`);
	if (new Set(declaredVersions).size > 1) throw new Error(`${packagePath} declares conflicting @types/node versions.`);

	const typesVersion = declaredVersions[0];
	const engine = parseVersion(engineRange, MINIMUM_ENGINE, `${packagePath} engines.node must use an explicit >=x.y.z minimum`);
	const types = parseVersion(typesVersion, TYPES_VERSION, `${packagePath} @types/node must use a single x.y.z, ^x.y.z, or ~x.y.z range`);
	if (engine.major !== types.major) {
		throw new Error(`${packagePath} @types/node ${typesVersion} exceeds the supported Node.js API baseline ${engineRange}; major versions must match.`);
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
if (entry === fileURLToPath(import.meta.url)) {
	try {
		await verifyNodeRuntime(resolve(process.argv[2] ?? '.'));
	} catch (error) {
		console.error(error instanceof Error ? error.message : error);
		process.exitCode = 1;
	}
}
