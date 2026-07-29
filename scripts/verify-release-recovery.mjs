import { createHash } from 'node:crypto';
import { access, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const FULL_SHA = /^[0-9a-f]{40}$/u;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const STABLE_TAG = /^v(\d+\.\d+\.\d+)$/u;

export async function verifyReleaseRecovery({ requestPath, artifactDirectory, root = repositoryRoot } = {}) {
	if (typeof requestPath !== 'string' || requestPath.length === 0) throw new Error('requestPath is required.');
	if (typeof artifactDirectory !== 'string' || artifactDirectory.length === 0) throw new Error('artifactDirectory is required.');

	const absoluteRequestPath = resolve(root, requestPath);
	assertInside(root, absoluteRequestPath, 'Recovery request');
	const request = JSON.parse(await readFile(absoluteRequestPath, 'utf8'));
	validateRequest(request);

	const verificationPath = resolve(root, request.verificationFile);
	assertInside(root, verificationPath, 'Verification record');
	const verification = JSON.parse(await readFile(verificationPath, 'utf8'));
	validateVerification(verification, request);

	const releaseDirectory = await resolveReleaseDirectory(resolve(root, artifactDirectory));
	const files = (await readdir(releaseDirectory)).sort();
	const expectedAssetNames = verification.assets.map(asset => asset.file).sort();
	assertSameSet(files, [...expectedAssetNames, 'SHA256SUMS'].sort(), 'release asset set');

	const checksums = parseChecksums(await readFile(resolve(releaseDirectory, 'SHA256SUMS'), 'utf8'));
	assertSameSet([...checksums.keys()].sort(), expectedAssetNames, 'SHA256SUMS file set');

	for (const expected of verification.assets) {
		const bytes = await readFile(resolve(releaseDirectory, expected.file));
		const sha256 = createHash('sha256').update(bytes).digest('hex');
		if (bytes.byteLength !== expected.bytes) throw new Error(`${expected.file} byte size mismatch.`);
		if (sha256 !== expected.sha256) throw new Error(`${expected.file} verification digest mismatch.`);
		if (checksums.get(expected.file) !== expected.sha256) throw new Error(`${expected.file} SHA256SUMS mismatch.`);
	}

	return {
		schemaVersion: 1,
		repository: request.repository,
		issue: request.issue,
		tag: request.tag,
		version: STABLE_TAG.exec(request.tag)[1],
		expectedCommit: request.expectedCommit,
		sourceRunId: request.sourceRunId,
		sourceArtifactId: request.sourceArtifactId,
		sourceArtifactName: request.sourceArtifactName,
		sourceArtifactDigest: request.sourceArtifactDigest,
		verificationFile: request.verificationFile,
		releaseDirectory,
		releaseTitle: `Virune ${request.tag}`,
		assetCount: files.length,
	};
}

export function validateRequest(request) {
	if (!isRecord(request) || request.schemaVersion !== 1) throw new Error('Recovery request must use schemaVersion 1.');
	if (request.repository !== 'yaona807/virune') throw new Error('Recovery request repository mismatch.');
	if (!Number.isInteger(request.issue) || request.issue <= 0) throw new Error('Recovery request issue must be a positive integer.');
	if (typeof request.tag !== 'string' || STABLE_TAG.exec(request.tag) === null) throw new Error('Recovery request tag must be a stable vMAJOR.MINOR.PATCH tag.');
	if (typeof request.expectedCommit !== 'string' || !FULL_SHA.test(request.expectedCommit)) throw new Error('Recovery request expectedCommit must be a full commit SHA.');
	if (!Number.isInteger(request.sourceRunId) || request.sourceRunId <= 0) throw new Error('Recovery request sourceRunId must be a positive integer.');
	if (!Number.isInteger(request.sourceArtifactId) || request.sourceArtifactId <= 0) throw new Error('Recovery request sourceArtifactId must be a positive integer.');
	if (typeof request.sourceArtifactName !== 'string' || request.sourceArtifactName.length === 0) throw new Error('Recovery request sourceArtifactName is required.');
	if (typeof request.sourceArtifactDigest !== 'string' || !DIGEST.test(request.sourceArtifactDigest)) throw new Error('Recovery request sourceArtifactDigest must be a SHA-256 digest.');
	if (request.verificationFile !== `.github/release-verification/${request.tag}.json`) throw new Error('Recovery request verificationFile must match the tag.');
	if (typeof request.reason !== 'string' || request.reason.trim().length < 20) throw new Error('Recovery request reason must contain at least 20 characters.');
}

export function validateVerification(verification, request) {
	if (!isRecord(verification) || verification.schemaVersion !== 1 || verification.passed !== true) throw new Error('Committed public verification evidence is not valid.');
	if (verification.repository !== request.repository) throw new Error('Verification repository mismatch.');
	if (verification.tag !== request.tag) throw new Error('Verification tag mismatch.');
	if (verification.tagCommit !== request.expectedCommit || verification.expectedCommit !== request.expectedCommit) throw new Error('Verification commit mismatch.');
	if (!Array.isArray(verification.assets) || verification.assets.length === 0) throw new Error('Verification record has no assets.');
	const names = new Set();
	for (const asset of verification.assets) {
		if (!isRecord(asset) || typeof asset.file !== 'string' || asset.file.length === 0) throw new Error('Verification asset name is invalid.');
		if (names.has(asset.file)) throw new Error(`Duplicate verification asset: ${asset.file}`);
		names.add(asset.file);
		if (typeof asset.sha256 !== 'string' || !/^[0-9a-f]{64}$/u.test(asset.sha256)) throw new Error(`Invalid verification digest for ${asset.file}.`);
		if (!Number.isInteger(asset.bytes) || asset.bytes <= 0) throw new Error(`Invalid verification byte size for ${asset.file}.`);
	}
}

export function parseChecksums(source) {
	const records = new Map();
	for (const line of source.trim().split(/\r?\n/u)) {
		const match = /^([0-9a-f]{64})  (.+)$/u.exec(line);
		if (match === null) throw new Error(`Invalid SHA256SUMS line: ${line}`);
		if (records.has(match[2])) throw new Error(`Duplicate SHA256SUMS entry: ${match[2]}`);
		records.set(match[2], match[1]);
	}
	return records;
}

async function resolveReleaseDirectory(directory) {
	const nested = resolve(directory, 'release');
	try {
		await access(resolve(nested, 'SHA256SUMS'));
		return nested;
	} catch {
		await access(resolve(directory, 'SHA256SUMS'));
		return directory;
	}
}

function assertSameSet(actual, expected, label) {
	if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${label} mismatch. expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`);
}

function assertInside(root, path, label) {
	const normalizedRoot = resolve(root);
	const normalizedPath = resolve(path);
	if (normalizedPath !== normalizedRoot && !normalizedPath.startsWith(`${normalizedRoot}${sep}`)) throw new Error(`${label} must remain inside the repository.`);
}

function isRecord(value) {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function argument(name) {
	return process.argv.find(item => item.startsWith(`--${name}=`))?.slice(name.length + 3);
}

const entry = process.argv[1] === undefined ? undefined : resolve(process.argv[1]);
if (entry === fileURLToPath(import.meta.url)) {
	const summary = await verifyReleaseRecovery({ requestPath: argument('request'), artifactDirectory: argument('artifact') });
	const output = argument('github-output');
	if (output !== undefined) {
		await writeFile(output, [
			`tag=${summary.tag}`,
			`version=${summary.version}`,
			`expected_commit=${summary.expectedCommit}`,
			`source_run_id=${summary.sourceRunId}`,
			`source_artifact_id=${summary.sourceArtifactId}`,
			`source_artifact_name=${summary.sourceArtifactName}`,
			`source_artifact_digest=${summary.sourceArtifactDigest}`,
			`release_directory=${summary.releaseDirectory}`,
			`release_title=${summary.releaseTitle}`,
			`issue=${summary.issue}`,
		].join('\n') + '\n', { flag: 'a' });
	}
	console.log(JSON.stringify(summary));
}
