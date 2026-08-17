import { gunzipSync } from 'node:zlib';

const BLOCK_SIZE = 512;
const CHECKSUM_OFFSET = 148;
const CHECKSUM_LENGTH = 8;
const SIZE_OFFSET = 124;
const SIZE_LENGTH = 12;

export function validateNpmTarArchive(tgzBytes, path) {
	let tar;
	try {
		tar = gunzipSync(tgzBytes);
	} catch (error) {
		throw new Error(`${path}: invalid gzip tarball: ${error instanceof Error ? error.message : String(error)}`);
	}
	assert(tar.byteLength >= BLOCK_SIZE * 2, path, 'tar archive is missing the canonical two-block end marker');

	let offset = 0;
	while (offset + BLOCK_SIZE <= tar.byteLength) {
		const header = tar.subarray(offset, offset + BLOCK_SIZE);
		if (isZeroBlock(header)) {
			const secondEndOffset = offset + BLOCK_SIZE;
			assert(secondEndOffset + BLOCK_SIZE <= tar.byteLength, path, 'tar archive is missing the canonical second end block');
			assert(isZeroBlock(tar.subarray(secondEndOffset, secondEndOffset + BLOCK_SIZE)), path, 'tar archive is missing the canonical second end block');
			assert(tar.subarray(secondEndOffset + BLOCK_SIZE).every(byte => byte === 0), path, 'tar archive contains non-zero data after the canonical end marker');
			return true;
		}

		const name = tarString(header, 0, 100) || '<unnamed>';
		const declaredChecksum = parseOctalField(header, CHECKSUM_OFFSET, CHECKSUM_LENGTH, path, `checksum for ${name}`);
		let actualChecksum = 0;
		for (let index = 0; index < BLOCK_SIZE; index += 1) {
			actualChecksum += index >= CHECKSUM_OFFSET && index < CHECKSUM_OFFSET + CHECKSUM_LENGTH ? 0x20 : header[index];
		}
		assert(declaredChecksum === actualChecksum, path, `invalid tar header checksum for ${name}`);

		const size = parseOctalField(header, SIZE_OFFSET, SIZE_LENGTH, path, `size for ${name}`);
		const dataStart = offset + BLOCK_SIZE;
		const paddedSize = Math.ceil(size / BLOCK_SIZE) * BLOCK_SIZE;
		const nextOffset = dataStart + paddedSize;
		assert(Number.isSafeInteger(nextOffset) && nextOffset <= tar.byteLength, path, `truncated tar entry ${name}`);
		offset = nextOffset;
	}

	throw new Error(`${path}: tar archive is missing the canonical two-block end marker`);
}

function parseOctalField(header, start, length, path, description) {
	const field = header.subarray(start, start + length);
	assert((field[0] & 0x80) === 0, path, `unsupported base-256 tar ${description}`);
	const text = field.toString('ascii');
	const core = text.replace(/[\0 ]+$/u, '').trimStart();
	assert(core.length === 0 || /^[0-7]+$/u.test(core), path, `invalid octal tar ${description}`);
	if (core.length === 0) return 0;
	const value = Number.parseInt(core, 8);
	assert(Number.isSafeInteger(value) && value >= 0, path, `invalid tar ${description}`);
	return value;
}

function tarString(header, start, length) {
	return header.subarray(start, start + length).toString('utf8').replace(/\0.*$/su, '');
}

function isZeroBlock(block) {
	return block.byteLength === BLOCK_SIZE && block.every(byte => byte === 0);
}

function assert(condition, path, message) {
	if (!condition) throw new Error(`${path}: ${message}`);
}
