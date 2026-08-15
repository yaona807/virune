import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const EXPECTED_LICENSE_ID = 'Apache-2.0';
// Git object identity of the canonical, unmodified Apache License 2.0 text committed for #383.
// This is a byte-identity anchor, not a cryptographic security decision.
const EXPECTED_LICENSE_GIT_BLOB_SHA = '261eeb9e9f8b2b4b0d119366dda99c6fd7d35c64';
const EXPECTED_NOTICE = 'Virune\nCopyright 2026 Yaona and the Virune project authors\n';

export function verifyRepositoryLicensePolicy(root = repositoryRoot) {
	const rootManifest = readJson(resolve(root, 'package.json'));
	if (rootManifest.license !== EXPECTED_LICENSE_ID) {
		throw new Error(`Root package license must be ${EXPECTED_LICENSE_ID}; received ${JSON.stringify(rootManifest.license)}`);
	}

	const licenseBytes = readFileSync(resolve(root, 'LICENSE'));
	const licenseBlobSha = gitBlobSha(licenseBytes);
	if (licenseBlobSha !== EXPECTED_LICENSE_GIT_BLOB_SHA) {
		throw new Error(`Root LICENSE must be the canonical unmodified Apache-2.0 text (${EXPECTED_LICENSE_GIT_BLOB_SHA}); received ${licenseBlobSha}`);
	}
	const noticeBytes = readFileSync(resolve(root, 'NOTICE'));
	if (noticeBytes.toString('utf8') !== EXPECTED_NOTICE) {
		throw new Error('Root NOTICE must contain the reviewed Virune attribution exactly');
	}

	const workspaceDirectories = readdirSync(resolve(root, 'packages'), { withFileTypes: true })
		.filter(entry => entry.isDirectory() && existsSync(resolve(root, 'packages', entry.name, 'package.json')))
		.map(entry => entry.name)
		.sort();
	if (workspaceDirectories.length === 0) throw new Error('No package workspaces were found');

	for (const directory of workspaceDirectories) {
		const workspaceRoot = resolve(root, 'packages', directory);
		const manifest = readJson(resolve(workspaceRoot, 'package.json'));
		if (manifest.license !== EXPECTED_LICENSE_ID) {
			throw new Error(`packages/${directory}/package.json license must be ${EXPECTED_LICENSE_ID}`);
		}
		assertEqualBytes(readFileSync(resolve(workspaceRoot, 'LICENSE')), licenseBytes, `packages/${directory}/LICENSE`);
		assertEqualBytes(readFileSync(resolve(workspaceRoot, 'NOTICE')), noticeBytes, `packages/${directory}/NOTICE`);
	}

	return { license: EXPECTED_LICENSE_ID, workspaces: workspaceDirectories };
}

function gitBlobSha(bytes) {
	return createHash('sha1')
		.update(Buffer.from(`blob ${bytes.byteLength}\0`, 'utf8'))
		.update(bytes)
		.digest('hex');
}

function assertEqualBytes(actual, expected, label) {
	if (!actual.equals(expected)) throw new Error(`${label} must match the reviewed repository root file byte-for-byte`);
}

function readJson(path) {
	return JSON.parse(readFileSync(path, 'utf8'));
}

const entry = process.argv[1] === undefined ? undefined : resolve(process.argv[1]);
if (entry === fileURLToPath(import.meta.url)) {
	const result = verifyRepositoryLicensePolicy();
	console.log(`Repository license policy verified: ${result.license}, ${result.workspaces.length} workspaces.`);
}
