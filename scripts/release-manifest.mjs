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
	const sbomFile = 'SBOM.cdx.json';
	if (!releaseFiles.includes(sbomFile)) throw new Error(`${sbomFile} must exist before release integrity files are generated.`);
	const sbom = JSON.parse(readFileSync(resolve(releaseDirectory, sbomFile), 'utf8'));
	if (sbom.bomFormat !== 'CycloneDX' || typeof sbom.specVersion !== 'string' || typeof sbom.serialNumber !== 'string') {
		throw new Error('Invalid CycloneDX release SBOM.');
	}
	const releaseManifest = {
		schemaVersion: 2,
		version,
		generatedBy: 'scripts/release-manifest.mjs',
		sbom: {
			...digest(sbomFile),
			format: sbom.bomFormat,
			specVersion: sbom.specVersion,
			serialNumber: sbom.serialNumber,
		},
		provenance: {
			provider: 'GitHub Artifact Attestations',
			subjects: 'SHA256SUMS',
			verificationCommand: 'gh attestation verify <asset> --repo yaona807/virune',
			sbomVerificationCommand: 'gh attestation verify <asset> --repo yaona807/virune --predicate-type https://cyclonedx.org/bom',
		},
		verification: {
			checksums: 'sha256sum --check SHA256SUMS',
			manifest: 'Verify each file size and SHA-256 digest against RELEASE-MANIFEST.json.',
		},
		files: releaseFiles.map(digest),
	};
	writeFileSync(resolve(releaseDirectory, 'RELEASE-MANIFEST.json'), `${JSON.stringify(releaseManifest, null, 2)}\n`);

	const checksumFiles = readdirSync(releaseDirectory)
		.filter(file => file !== 'SHA256SUMS')
		.sort();
	const checksumLines = checksumFiles.map(file => `${digest(file).sha256}  ${file}`);
	writeFileSync(resolve(releaseDirectory, 'SHA256SUMS'), `${checksumLines.join('\n')}\n`);
};
