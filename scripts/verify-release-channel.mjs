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
	const gateDocument = await readFile(resolve('docs/stable-release-gate.md'), 'utf8');
	const gate = JSON.parse(await readFile(resolve('.github/stable-release-gate.json'), 'utf8'));
	if (!gateDocument.includes('release-evidence.json')) throw new Error('Stable release gate evidence is not documented.');
	if (gate.schemaVersion !== 1 || !Array.isArray(gate.checks) || !Array.isArray(gate.requirements)) throw new Error('Stable release gate policy is invalid.');
	const required = ['public-abi', 'nightly-evidence', 'clean-install', 'node-browser-conformance'];
	const configured = new Set(gate.requirements.map(item => item.id));
	for (const id of required) if (!configured.has(id)) throw new Error(`Stable release gate requirement is missing: ${id}`);
}
const releaseChannels = await readFile(resolve('docs/release-channels.md'), 'utf8');
if (/npm distribution channels|npm tag/iu.test(releaseChannels)) throw new Error('Release channel documentation must describe GitHub Releases rather than npm Registry dist-tags.');
console.log(`Verified ${packages.length} package versions for GitHub Release channel ${channel} (${root.version}).`);
