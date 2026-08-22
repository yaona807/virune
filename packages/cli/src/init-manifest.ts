export interface GeneratedProjectPackageManifest {
	readonly name: string;
	readonly private: true;
	readonly type: 'module';
	readonly scripts: {
		readonly build: 'virune build';
		readonly start: 'virune run';
		readonly test: 'virune test';
		readonly check: 'virune check';
		readonly fmt: 'virune fmt .';
	};
	readonly dependencies: Readonly<Record<'@virune/runtime' | '@virune/stdlib', string>>;
	readonly devDependencies: Readonly<Record<'virune', string>>;
}

const FIRST_REGISTRY_RELEASE = Object.freeze({ major: 1, minor: 1, patch: 0 });

export function buildGeneratedProjectPackageManifest(projectName: string, version: string): GeneratedProjectPackageManifest {
	const dependencies = generatedProjectDependencyVersions(version);
	return {
		name: projectName,
		private: true,
		type: 'module',
		scripts: {
			build: 'virune build',
			start: 'virune run',
			test: 'virune test',
			check: 'virune check',
			fmt: 'virune fmt .',
		},
		dependencies: {
			'@virune/runtime': dependencies.runtime,
			'@virune/stdlib': dependencies.stdlib,
		},
		devDependencies: { virune: dependencies.cli },
	};
}

export function generatedProjectDependencyVersions(version: string): {
	readonly source: 'github-release' | 'npm';
	readonly cli: string;
	readonly runtime: string;
	readonly stdlib: string;
} {
	const parsed = parseReleaseVersion(version);
	if (compareCoreVersion(parsed, FIRST_REGISTRY_RELEASE) >= 0 && parsed.channel !== 'nightly') {
		return { source: 'npm', cli: version, runtime: version, stdlib: version };
	}
	const releaseBase = `https://github.com/yaona807/virune/releases/download/v${version}`;
	return {
		source: 'github-release',
		cli: `${releaseBase}/virune-${version}.tgz`,
		runtime: `${releaseBase}/virune-runtime-${version}.tgz`,
		stdlib: `${releaseBase}/virune-stdlib-${version}.tgz`,
	};
}

function parseReleaseVersion(version: string): {
	readonly major: number;
	readonly minor: number;
	readonly patch: number;
	readonly channel: 'stable' | 'prerelease' | 'nightly';
} {
	const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*))?(?:\+[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/u.exec(version);
	if (match === null) throw new Error(`Invalid Virune release version ${version}.`);
	const major = Number(match[1]);
	const minor = Number(match[2]);
	const patch = Number(match[3]);
	if (![major, minor, patch].every(Number.isSafeInteger)) throw new Error(`Virune release version is outside the supported integer range: ${version}.`);
	const prerelease = match[4];
	const channel = prerelease === undefined ? 'stable' : prerelease.startsWith('nightly.') ? 'nightly' : 'prerelease';
	return { major, minor, patch, channel };
}

function compareCoreVersion(
	left: { readonly major: number; readonly minor: number; readonly patch: number },
	right: { readonly major: number; readonly minor: number; readonly patch: number },
): number {
	if (left.major !== right.major) return left.major < right.major ? -1 : 1;
	if (left.minor !== right.minor) return left.minor < right.minor ? -1 : 1;
	if (left.patch !== right.patch) return left.patch < right.patch ? -1 : 1;
	return 0;
}
