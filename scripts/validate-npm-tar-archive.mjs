import { TextDecoder } from 'node:util';
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

		const block = offset / BLOCK_SIZE;
		const declaredChecksum = parseOctalField(header, CHECKSUM_OFFSET, CHECKSUM_LENGTH, path, `checksum for entry at block ${block}`);
		let actualChecksum = 0;
		for (let index = 0; index < BLOCK_SIZE; index += 1) {
			actualChecksum += index >= CHECKSUM_OFFSET && index < CHECKSUM_OFFSET + CHECKSUM_LENGTH ? 0x20 : header[index];
		}
		assert(declaredChecksum === actualChecksum, path, `invalid tar header checksum for entry at block ${block}`);

		const name = decodeTarPathField(header, 0, 100, path, 'entry name', { required: true });
		const prefix = decodeTarPathField(header, 345, 155, path, 'entry prefix');
		const fullName = prefix.length > 0 ? `${prefix}/${name}` : name;
		const size = parseOctalField(header, SIZE_OFFSET, SIZE_LENGTH, path, `size for ${fullName}`);
		const dataStart = offset + BLOCK_SIZE;
		const paddedSize = Math.ceil(size / BLOCK_SIZE) * BLOCK_SIZE;
		const nextOffset = dataStart + paddedSize;
		assert(Number.isSafeInteger(nextOffset) && nextOffset <= tar.byteLength, path, `truncated tar entry ${fullName}`);
		offset = nextOffset;
	}

	throw new Error(`${path}: tar archive is missing the canonical two-block end marker`);
}

function parseOctalField(header, start, length, path, description) {
	const field = header.subarray(start, start + length);
	assert((field[0] & 0x80) === 0, path, `unsupported base-256 tar ${description}`);
	const text = field.toString('latin1');
	const core = text.replace(/[\0 ]+$/u, '').trimStart();
	assert(core.length === 0 || /^[0-7]+$/u.test(core), path, `invalid octal tar ${description}`);
	if (core.length === 0) return 0;
	const value = Number.parseInt(core, 8);
	assert(Number.isSafeInteger(value) && value >= 0, path, `invalid tar ${description}`);
	return value;
}

function decodeTarPathField(header, start, length, path, description, { required = false } = {}) {
	const field = header.subarray(start, start + length);
	const nulIndex = field.indexOf(0);
	const bytes = nulIndex === -1 ? field : field.subarray(0, nulIndex);
	if (nulIndex !== -1) {
		assert(field.subarray(nulIndex).every(byte => byte === 0), path, `non-zero data after NUL in tar ${description}`);
	}
	let text;
	try {
		text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
	} catch {
		throw new Error(`${path}: invalid UTF-8 tar ${description}`);
	}
	if (required) assert(text.length > 0, path, `tar ${description} must not be empty`);
	return text;
}

function isZeroBlock(block) {
	return block.byteLength === BLOCK_SIZE && block.every(byte => byte === 0);
}

function assert(condition, path, message) {
	if (!condition) throw new Error(`${path}: ${message}`);
}
