import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));

export function buildCycloneDxSbom({ lock, manifest, commit = null }) {
	if (lock?.lockfileVersion !== 3 || typeof lock.packages !== 'object' || lock.packages === null) {
		throw new Error('A package-lock.json with lockfileVersion 3 is required.');
	}
	if (typeof manifest?.name !== 'string' || typeof manifest?.version !== 'string') {
		throw new Error('A package manifest with name and version is required.');
	}

	const packageEntries = new Map(Object.entries(lock.packages));
	const componentsByPath = new Map();
	const componentsByRef = new Map();
	for (const [path, entry] of packageEntries) {
		if (path === '' || !entry || typeof entry.version !== 'string') continue;
		const name = packageName(path, entry);
		if (name === undefined) continue;
		const purl = npmPurl(name, entry.version);
		const properties = [
			{ name: 'virune:package-lock:path', value: path },
			...(typeof entry.resolved === 'string' ? [{ name: 'virune:package-lock:resolved', value: entry.resolved }] : []),
			...(typeof entry.integrity === 'string' ? [{ name: 'virune:package-lock:integrity', value: entry.integrity }] : []),
		];
		const existing = componentsByRef.get(purl);
		const component = existing ?? {
			type: name === 'virune' ? 'application' : 'library',
			'bom-ref': purl,
			name,
			version: entry.version,
			purl,
			scope: entry.dev === true ? 'optional' : 'required',
			...(typeof entry.license === 'string' ? { licenses: [{ license: { id: entry.license } }] } : {}),
			properties: [],
		};
		if (entry.dev !== true) component.scope = 'required';
		if (component.licenses === undefined && typeof entry.license === 'string') component.licenses = [{ license: { id: entry.license } }];
		component.properties = uniqueProperties([...component.properties, ...properties]);
		componentsByRef.set(purl, component);
		componentsByPath.set(path, component);
	}

	const rootRef = npmPurl(manifest.name, manifest.version);
	const dependencyGraph = new Map([[rootRef, new Set()]]);
	for (const name of dependencyNames(manifest)) {
		const reference = resolveDependencyReference('', name, packageEntries, componentsByPath);
		if (reference !== undefined) dependencyGraph.get(rootRef).add(reference);
	}
	for (const [path, component] of [...componentsByPath.entries()].sort(([left], [right]) => left.localeCompare(right))) {
		const dependsOn = dependencyGraph.get(component['bom-ref']) ?? new Set();
		for (const name of dependencyNames(packageEntries.get(path))) {
			const reference = resolveDependencyReference(path, name, packageEntries, componentsByPath);
			if (reference !== undefined && reference !== component['bom-ref']) dependsOn.add(reference);
		}
		dependencyGraph.set(component['bom-ref'], dependsOn);
	}

	const normalizedCommit = commit ?? 'unknown';
	const identity = createHash('sha256')
		.update(JSON.stringify({ commit: normalizedCommit, lock, version: manifest.version }))
		.digest('hex');
	const serialNumber = deterministicUuidUrn(identity);
	const components = [...componentsByRef.values()].sort((left, right) => left['bom-ref'].localeCompare(right['bom-ref']));
	const dependencies = [...dependencyGraph.entries()]
		.map(([ref, dependsOn]) => ({ ref, dependsOn: [...dependsOn].sort() }))
		.sort((left, right) => left.ref.localeCompare(right.ref));
	return {
		bomFormat: 'CycloneDX',
		specVersion: '1.6',
		serialNumber,
		version: 1,
		metadata: {
			component: {
				type: 'application',
				'bom-ref': rootRef,
				name: manifest.name,
				version: manifest.version,
				purl: rootRef,
				externalReferences: [{
					type: 'vcs',
					url: 'https://github.com/yaona807/virune',
				}],
				properties: [
					{ name: 'virune:release:commit', value: normalizedCommit },
					{ name: 'virune:release:lockfileVersion', value: String(lock.lockfileVersion) },
				],
			},
			tools: {
				components: [{
					type: 'application',
					name: 'Virune release SBOM generator',
					version: manifest.version,
				}],
			},
		},
		components,
		dependencies,
	};
}

export function writeReleaseSbom({
	root = repositoryRoot,
	output = resolve(root, 'release/SBOM.cdx.json'),
	commit = process.env.GITHUB_SHA ?? process.env.VIRUNE_RELEASE_COMMIT ?? null,
} = {}) {
	const lock = JSON.parse(readFileSync(resolve(root, 'package-lock.json'), 'utf8'));
	const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
	const sbom = buildCycloneDxSbom({ lock, manifest, commit });
	writeFileSync(output, `${JSON.stringify(sbom, null, 2)}\n`, 'utf8');
	console.log(`Wrote CycloneDX ${sbom.specVersion} SBOM with ${sbom.components.length} components: ${output}`);
	return sbom;
}

function packageName(path, entry) {
	if (typeof entry.name === 'string' && entry.name.length > 0) return entry.name;
	const marker = 'node_modules/';
	const index = path.lastIndexOf(marker);
	if (index === -1) return undefined;
	const remainder = path.slice(index + marker.length);
	if (remainder.startsWith('@')) return remainder.split('/').slice(0, 2).join('/');
	return remainder.split('/')[0];
}

function npmPurl(name, version) {
	const encodedName = name.startsWith('@')
		? `%40${name.slice(1).split('/').map(encodeURIComponent).join('/')}`
		: encodeURIComponent(name);
	return `pkg:npm/${encodedName}@${encodeURIComponent(version)}`;
}

function dependencyNames(entry) {
	if (!entry || typeof entry !== 'object') return [];
	return [...new Set([
		...Object.keys(entry.dependencies ?? {}),
		...Object.keys(entry.optionalDependencies ?? {}),
		...Object.keys(entry.peerDependencies ?? {}),
		...Object.keys(entry.devDependencies ?? {}),
	])].sort();
}

function resolveDependencyReference(fromPath, name, packageEntries, componentsByPath) {
	for (const candidate of dependencyCandidates(fromPath, name)) {
		const entry = packageEntries.get(candidate);
		if (entry === undefined) continue;
		if (entry?.link === true && typeof entry.resolved === 'string') {
			return componentsByPath.get(entry.resolved)?.['bom-ref'];
		}
		return componentsByPath.get(candidate)?.['bom-ref'];
	}
	const matches = [...new Set([...componentsByPath.values()
		.filter(component => component.name === name)
		.map(component => component['bom-ref'])])];
	return matches.length === 1 ? matches[0] : undefined;
}

function dependencyCandidates(fromPath, name) {
	const candidates = [];
	let current = fromPath;
	while (true) {
		candidates.push(current === '' ? `node_modules/${name}` : `${current}/node_modules/${name}`);
		if (current === '') break;
		const nested = current.lastIndexOf('/node_modules/');
		if (nested !== -1) current = current.slice(0, nested);
		else current = '';
	}
	return candidates;
}

function uniqueProperties(properties) {
	const byIdentity = new Map(properties.map(property => [`${property.name}\u0000${property.value}`, property]));
	return [...byIdentity.values()].sort((left, right) => left.name.localeCompare(right.name) || left.value.localeCompare(right.value));
}

function deterministicUuidUrn(hex) {
	const bytes = hex.slice(0, 32).split('');
	bytes[12] = '5';
	bytes[16] = (Number.parseInt(bytes[16], 16) & 0x3 | 0x8).toString(16);
	const value = bytes.join('');
	return `urn:uuid:${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

const entry = process.argv[1] === undefined ? undefined : resolve(process.argv[1]);
if (entry === fileURLToPath(import.meta.url)) writeReleaseSbom();
