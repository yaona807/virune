import { readFile } from 'node:fs/promises';

const npmrc = await readFile(new URL('../.npmrc', import.meta.url), 'utf8');
if (!/^registry=https:\/\/registry\.npmjs\.org\/$/m.test(npmrc)) {
	throw new Error('.npmrc must pin registry=https://registry.npmjs.org/');
}
if (!/^replace-registry-host=never$/m.test(npmrc)) {
	throw new Error('.npmrc must set replace-registry-host=never');
}

const lock = JSON.parse(await readFile(new URL('../package-lock.json', import.meta.url), 'utf8'));
for (const [packagePath, entry] of Object.entries(lock.packages ?? {})) {
	const resolved = entry?.resolved;
	if (typeof resolved !== 'string' || !/^https?:\/\//.test(resolved)) {
		continue;
	}
	const url = new URL(resolved);
	if (url.origin !== 'https://registry.npmjs.org') {
		throw new Error(`Non-public registry URL in package-lock.json at ${packagePath || '<root>'}: ${resolved}`);
	}
}

const environmentRegistry = Object.entries(process.env).find(
	([key]) => key.toLowerCase() === 'npm_config_registry',
)?.[1];
if (environmentRegistry && environmentRegistry !== 'https://registry.npmjs.org/') {
	console.warn(
		`Warning: ${environmentRegistry} is set through NPM_CONFIG_REGISTRY and overrides the project .npmrc. ` +
		'Use npm run bootstrap or pass --registry=https://registry.npmjs.org/ --replace-registry-host=never.',
	);
}

console.log('Verified public npm registry configuration and package-lock.json URLs.');
