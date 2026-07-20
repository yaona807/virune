import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const writeReleaseIntegrityFiles = (releaseDirectory, version) => {
	const digest = file => {
		const bytes = readFileSync(resolve(releaseDirectory, file));
		return { file, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.byteLength };
	};

	const releaseFiles = readdirSync(releaseDirectory)
		.filter(file => file !== 'RELEASE-MANIFEST.json' && file !== 'SHA256SUMS')
		.sort();
	const releaseManifest = {
		schemaVersion: 1,
		version,
		generatedBy: 'scripts/release-manifest.mjs',
		files: releaseFiles.map(digest),
	};
	writeFileSync(resolve(releaseDirectory, 'RELEASE-MANIFEST.json'), `${JSON.stringify(releaseManifest, null, 2)}\n`);

	const checksumFiles = readdirSync(releaseDirectory)
		.filter(file => file !== 'SHA256SUMS')
		.sort();
	const checksumLines = checksumFiles.map(file => `${digest(file).sha256}  ${file}`);
	writeFileSync(resolve(releaseDirectory, 'SHA256SUMS'), `${checksumLines.join('\n')}\n`);
};
