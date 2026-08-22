export type InitDependencySource = 'github-release' | 'npm';

export interface InitOptions {
	readonly projectPath: string;
	readonly dependencySource: InitDependencySource;
}

export interface NpmGeneratedProjectCapability {
	readonly schemaVersion: 1;
	readonly kind: 'npm-generated-project-dependency-source-v1';
	readonly version: string;
	readonly registry: 'https://registry.npmjs.org/';
	readonly dependencySource: 'npm';
}

export const NPM_GENERATED_PROJECT_CAPABILITY_FIELD = 'viruneDistribution';
export const PUBLIC_NPM_REGISTRY = 'https://registry.npmjs.org/' as const;

const DEPENDENCY_SOURCE_PREFIX = '--dependency-source=';

export function parseInitOptions(argumentsList: readonly string[]): InitOptions {
	let projectPath: string | undefined;
	let dependencySource: InitDependencySource | undefined;
	for (const argument of argumentsList) {
		if (argument.startsWith(DEPENDENCY_SOURCE_PREFIX)) {
			if (dependencySource !== undefined) throw new Error('Specify --dependency-source at most once.');
			const value = argument.slice(DEPENDENCY_SOURCE_PREFIX.length);
			if (value !== 'github-release' && value !== 'npm') {
				throw new Error('Expected --dependency-source=github-release or --dependency-source=npm.');
			}
			dependencySource = value;
			continue;
		}
		if (argument.startsWith('-')) throw new Error(`Unknown init option ${argument}.`);
		if (projectPath !== undefined) throw new Error('virune init accepts at most one project path.');
		if (argument.length === 0) throw new Error('Virune project path must not be empty.');
		projectPath = argument;
	}
	return {
		projectPath: projectPath ?? '.',
		dependencySource: dependencySource ?? 'github-release',
	};
}

export function validateNpmGeneratedProjectCapability(
	value: unknown,
	expectedVersion: string,
): NpmGeneratedProjectCapability {
	assert(typeof expectedVersion === 'string' && expectedVersion.length > 0, 'expected a non-empty Virune version');
	const capability = record(value, 'npm generated-project capability');
	assertExactKeys(capability, ['schemaVersion', 'kind', 'version', 'registry', 'dependencySource']);
	assert(capability.schemaVersion === 1, 'expected schemaVersion 1');
	assert(capability.kind === 'npm-generated-project-dependency-source-v1', 'unexpected capability kind');
	assert(capability.version === expectedVersion, `expected capability version ${expectedVersion}`);
	assert(capability.registry === PUBLIC_NPM_REGISTRY, `expected Registry ${PUBLIC_NPM_REGISTRY}`);
	assert(capability.dependencySource === 'npm', 'expected npm dependency source capability');
	return {
		schemaVersion: 1,
		kind: 'npm-generated-project-dependency-source-v1',
		version: expectedVersion,
		registry: PUBLIC_NPM_REGISTRY,
		dependencySource: 'npm',
	};
}

function record(value: unknown, label: string): Record<string, unknown> {
	assert(value !== null && typeof value === 'object' && !Array.isArray(value), `${label} must be an object`);
	return value as Record<string, unknown>;
}

function assertExactKeys(value: Record<string, unknown>, expected: readonly string[]): void {
	const actual = Object.keys(value).sort(compareText);
	const wanted = [...expected].sort(compareText);
	assert(JSON.stringify(actual) === JSON.stringify(wanted), `expected exact capability keys ${wanted.join(', ')}`);
}

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(`Invalid npm generated-project capability: ${message}`);
}

function compareText(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}
