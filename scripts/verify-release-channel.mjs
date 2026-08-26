import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { verifyNpmPublicationPlan } from './verify-npm-publication-plan.mjs';

const REQUIRED_STABLE_GATE_IDS = ['public-abi', 'nightly-evidence', 'clean-install', 'node-browser-conformance'];

export async function verifyReleaseChannel(rootDirectory = process.cwd()) {
	const root = JSON.parse(await readFile(resolve(rootDirectory, 'package.json'), 'utf8'));
	const directories = await readdir(resolve(rootDirectory, 'packages'), { withFileTypes: true });
	const packages = [];
	for (const directory of directories) {
		if (!directory.isDirectory()) continue;
		const file = resolve(rootDirectory, 'packages', directory.name, 'package.json');
		try {
			packages.push(JSON.parse(await readFile(file, 'utf8')));
		} catch {
			// Directories without a package manifest are outside the workspace package set.
		}
	}
	for (const pkg of packages) {
		if (pkg.version !== root.version) throw new Error(`${pkg.name} version ${pkg.version} differs from root ${root.version}`);
		for (const dependencies of [pkg.dependencies, pkg.devDependencies, pkg.peerDependencies, pkg.optionalDependencies]) {
			for (const [name, version] of Object.entries(dependencies ?? {})) {
				if ((name === 'virune' || name.startsWith('@virune/')) && version !== root.version) {
					throw new Error(`${pkg.name} depends on ${name}@${version}; expected ${root.version}`);
				}
			}
		}
	}

	const channel = root.version.includes('-nightly.') ? 'nightly' : root.version.includes('-') ? 'next' : 'stable';
	if (channel === 'stable') {
		const gate = JSON.parse(await readFile(resolve(rootDirectory, '.github/stable-release-gate.json'), 'utf8'));
		if (gate.schemaVersion !== 1 || !Array.isArray(gate.checks) || !Array.isArray(gate.requirements)) {
			throw new Error('Stable release gate policy is invalid.');
		}
		const configured = new Set(gate.requirements.map(item => item.id));
		for (const id of REQUIRED_STABLE_GATE_IDS) {
			if (!configured.has(id)) throw new Error(`Stable release gate requirement is missing: ${id}`);
		}
	}

	const publicationPlan = verifyNpmPublicationPlan(rootDirectory);
	const result = {
		packageCount: packages.length,
		channel,
		version: root.version,
		firstStableRegistryRelease: publicationPlan.firstStableRegistryRelease,
		distTagPolicy: publicationPlan.distTagPolicy,
	};
	console.log(
		`Verified ${packages.length} package versions for release channel ${channel} (${root.version}); npm stable=${publicationPlan.distTagPolicy.stable}, prerelease=${publicationPlan.distTagPolicy.prerelease}, nightly=disabled.`,
	);
	return result;
}

const argvPath = process.argv[1];
if (argvPath !== undefined && import.meta.url === pathToFileURL(resolve(argvPath)).href) {
	await verifyReleaseChannel();
}
