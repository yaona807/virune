import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = JSON.parse(await readFile(resolve('package.json'), 'utf8'));
const directories = await readdir(resolve('packages'), { withFileTypes: true });
const packages = [];
for (const directory of directories) {
	if (!directory.isDirectory()) continue;
	const file = resolve('packages', directory.name, 'package.json');
	try { packages.push(JSON.parse(await readFile(file, 'utf8'))); } catch {}
}
for (const pkg of packages) {
	if (pkg.version !== root.version) throw new Error(`${pkg.name} version ${pkg.version} differs from root ${root.version}`);
	for (const dependencies of [pkg.dependencies, pkg.devDependencies, pkg.peerDependencies]) {
		for (const [name, version] of Object.entries(dependencies ?? {})) {
			if ((name === 'virune' || name.startsWith('@virune/')) && version !== root.version) {
				throw new Error(`${pkg.name} depends on ${name}@${version}; expected ${root.version}`);
			}
		}
}
}
const channel = root.version.includes('-nightly.') ? 'nightly' : root.version.includes('-') ? 'next' : 'stable';
if (channel === 'stable') {
	const gate = await readFile(resolve('docs/stable-release-gate.md'), 'utf8');
	if (!gate.includes('Stable release gate')) throw new Error('Stable release gate document is missing');
}
console.log(`Verified ${packages.length} package versions for npm channel ${channel} (${root.version}).`);
