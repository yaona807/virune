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
		const gateDocument = await readFile(resolve(rootDirectory, 'docs/stable-release-gate.md'), 'utf8');
		const gate = JSON.parse(await readFile(resolve(rootDirectory, '.github/stable-release-gate.json'), 'utf8'));
		if (!gateDocument.includes('release-evidence.json')) throw new Error('Stable release gate evidence is not documented.');
		if (gate.schemaVersion !== 1 || !Array.isArray(gate.checks) || !Array.isArray(gate.requirements)) throw new Error('Stable release gate policy is invalid.');
		const configured = new Set(gate.requirements.map(item => item.id));
		for (const id of REQUIRED_STABLE_GATE_IDS) {
			if (!configured.has(id)) throw new Error(`Stable release gate requirement is missing: ${id}`);
		}
	}

	const publicationPlan = verifyNpmPublicationPlan(rootDirectory);
	const englishReleaseChannels = await readFile(resolve(rootDirectory, 'docs/release-channels.md'), 'utf8');
	const japaneseReleaseChannels = await readFile(resolve(rootDirectory, 'docs/release-channels_ja.md'), 'utf8');
	verifyReleaseChannelDocumentation(publicationPlan, englishReleaseChannels, japaneseReleaseChannels);

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

export function verifyReleaseChannelDocumentation(publicationPlan, english, japanese) {
	const forbiddenVersion = publicationPlan.forbidRegistryPublishThroughVersion;
	const firstStableVersion = publicationPlan.firstStableRegistryRelease;
	const stableDistTag = publicationPlan.distTagPolicy?.stable;
	const prereleaseDistTag = publicationPlan.distTagPolicy?.prerelease;
	if (publicationPlan.distTagPolicy?.nightly !== null) {
		throw new Error('npm publication plan must disable nightly Registry publication before release-channel documentation can be verified.');
	}

	const englishPolicy = `**npm Registry policy:** \`v${forbiddenVersion}\` is not retro-published; first stable is \`v${firstStableVersion}\`; stable uses \`${stableDistTag}\`; prerelease uses \`${prereleaseDistTag}\`; nightly is not published to npm.`;
	const japanesePolicy = `**npm Registry方針:** \`v${forbiddenVersion}\`は後追いpublishしません。最初のstableは\`v${firstStableVersion}\`、stableは\`${stableDistTag}\`、prereleaseは\`${prereleaseDistTag}\`を使用し、nightlyはnpmへpublishしません。`;
	if (!english.includes(englishPolicy)) {
		throw new Error('English release-channel documentation does not match the canonical npm publication plan.');
	}
	if (!japanese.includes(japanesePolicy)) {
		throw new Error('Japanese release-channel documentation does not match the canonical npm publication plan.');
	}

	const englishGitHubInvariant = 'GitHub Releases remain an official immutable distribution channel for stable, prerelease, and nightly releases.';
	const japaneseGitHubInvariant = 'GitHub Releasesはstable、prerelease、nightlyのすべてで公式かつimmutableなdistribution channelとして維持します。';
	if (!english.includes(englishGitHubInvariant)) {
		throw new Error('English release-channel documentation must retain GitHub Releases as an official immutable distribution channel.');
	}
	if (!japanese.includes(japaneseGitHubInvariant)) {
		throw new Error('Japanese release-channel documentation must retain GitHub Releases as an official immutable distribution channel.');
	}
}

const argvPath = process.argv[1];
if (argvPath !== undefined && import.meta.url === pathToFileURL(resolve(argvPath)).href) {
	await verifyReleaseChannel();
}
