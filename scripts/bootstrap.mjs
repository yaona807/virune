import { spawnNpmSync } from './npm-cli.mjs';
const environment = { ...process.env };
for (const key of Object.keys(environment)) {
	const normalized = key.toLowerCase();
	if (normalized === 'npm_config_registry' || normalized === 'npm_config_replace_registry_host') {
		delete environment[key];
	}
}

const commonArguments = [
	'--registry=https://registry.npmjs.org/',
	'--replace-registry-host=never',
];

if (process.argv.includes('--check-config')) {
	for (const name of ['registry', 'replace-registry-host']) {
		const result = spawnNpmSync(
			['config', 'get', name, ...commonArguments],
			{ env: environment, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] },
		);
		if (result.status !== 0) {
			process.exit(result.status ?? 1);
		}
		process.stdout.write(result.stdout);
	}
	process.exit(0);
}

const result = spawnNpmSync(
	['ci', '--no-audit', ...commonArguments],
	{ env: environment, stdio: 'inherit' },
);
if (result.error) {
	throw result.error;
}
process.exit(result.status ?? 1);
