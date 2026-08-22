export function registryPolicyForVersion(version, firstStableRegistryRelease, distTagPolicy) {
	const parsed = parseReleaseVersion(version, '$.version');
	const firstStable = parseReleaseVersion(firstStableRegistryRelease, '$.firstStableRegistryRelease');
	assert(firstStable.channel === 'stable', '$.firstStableRegistryRelease', 'expected a stable semantic version');
	const tags = record(distTagPolicy, '$.distTagPolicy');
	const stableTag = nonEmptyString(tags.stable, '$.distTagPolicy.stable');
	const prereleaseTag = nonEmptyString(tags.prerelease, '$.distTagPolicy.prerelease');
	assert(stableTag === 'latest', '$.distTagPolicy.stable', 'stable npm publication must use latest');
	assert(prereleaseTag === 'next', '$.distTagPolicy.prerelease', 'prerelease npm publication must use next');
	assert(tags.nightly === null, '$.distTagPolicy.nightly', 'nightly npm publication must remain disabled');
	const beforeFirstStable = compareVersionTuple(parsed.base, firstStable.base) < 0;
	if (parsed.channel === 'nightly' || beforeFirstStable) {
		return { channel: parsed.channel, registryVersionEligible: false, distTag: null };
	}
	return {
		channel: parsed.channel,
		registryVersionEligible: true,
		distTag: parsed.channel === 'stable' ? stableTag : prereleaseTag,
	};
}

export function parseReleaseVersion(value, path = '$.version') {
	const text = nonEmptyString(value, path);
	const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:(?:-(alpha|beta|rc)\.(0|[1-9]\d*))|(?:-nightly\.(\d{8})\.(0|[1-9]\d*)))?$/u.exec(text);
	assert(match !== null, path, 'expected stable, alpha, beta, rc, or nightly Virune semantic version');
	const base = match.slice(1, 4).map(Number);
	const channel = match[6] !== undefined ? 'nightly' : match[4] !== undefined ? 'prerelease' : 'stable';
	return { text, base, channel };
}

function compareVersionTuple(left, right) {
	for (let index = 0; index < 3; index += 1) {
		if (left[index] !== right[index]) return left[index] < right[index] ? -1 : 1;
	}
	return 0;
}

function record(value, path) {
	assert(value !== null && typeof value === 'object' && !Array.isArray(value), path, 'expected an object');
	return value;
}

function nonEmptyString(value, path) {
	assert(typeof value === 'string' && value.trim().length > 0, path, 'expected a non-empty non-whitespace string');
	return value;
}

function assert(condition, path, message) {
	if (!condition) throw new Error(`${path}: ${message}`);
}
