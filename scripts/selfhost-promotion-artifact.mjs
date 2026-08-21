import { createHash } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';

const LOCAL_FILE_HEADER = 0x04034b50;
const CENTRAL_DIRECTORY_HEADER = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const DATA_DESCRIPTOR = 0x08074b50;
const MAX_EOCD_SEARCH = 65_557;
const DEFAULT_MAX_UNCOMPRESSED_BYTES = 4 * 1024 * 1024;
const sha256DigestPattern = /^sha256:([0-9a-f]{64})$/u;
const textDecoder = new TextDecoder('utf-8', { fatal: true });

export class PromotionArtifactError extends Error {
	constructor(path, message) {
		super(`${path}: ${message}`);
		this.name = 'PromotionArtifactError';
		this.path = path;
	}
}

export function readCanonicalJsonArtifactZip({
	archiveBytes,
	providerDigest,
	expectedFileName,
	maxUncompressedBytes = DEFAULT_MAX_UNCOMPRESSED_BYTES,
}) {
	const archive = toBuffer(archiveBytes, 'archiveBytes');
	if (!Number.isSafeInteger(maxUncompressedBytes) || maxUncompressedBytes <= 0) {
		throw new PromotionArtifactError('maxUncompressedBytes', 'expected positive safe integer');
	}
	const digestMatch = typeof providerDigest === 'string' ? sha256DigestPattern.exec(providerDigest) : null;
	if (digestMatch === null) throw new PromotionArtifactError('providerDigest', 'expected sha256:<lowercase-hex>');
	const archiveSha256 = sha256(archive);
	if (archiveSha256 !== digestMatch[1]) throw new PromotionArtifactError('providerDigest', 'provider archive digest does not match downloaded bytes');
	if (typeof expectedFileName !== 'string' || !/^[A-Za-z0-9._-]+\.json$/u.test(expectedFileName)) {
		throw new PromotionArtifactError('expectedFileName', 'expected a simple canonical JSON artifact filename');
	}

	const fileBytes = extractSingleZipEntry(archive, expectedFileName, maxUncompressedBytes);
	let text;
	try {
		text = textDecoder.decode(fileBytes);
	} catch {
		throw new PromotionArtifactError('artifact', 'inner artifact is not valid UTF-8');
	}
	if (text.length === 0) throw new PromotionArtifactError('artifact', 'inner artifact is empty');
	if (text.charCodeAt(0) === 0xfeff) throw new PromotionArtifactError('artifact', 'UTF-8 BOM is not canonical');
	let value;
	try {
		value = JSON.parse(text);
	} catch {
		throw new PromotionArtifactError('artifact', 'inner artifact is not valid JSON');
	}
	const canonical = JSON.stringify(value);
	if (canonical !== text) throw new PromotionArtifactError('artifact', 'inner JSON must use byte-exact canonical JSON serialization');
	return {
		value,
		text,
		archiveSha256,
		bytesSha256: sha256(fileBytes),
		byteLength: fileBytes.length,
	};
}

function extractSingleZipEntry(archive, expectedFileName, maxUncompressedBytes) {
	if (archive.length < 22) throw new PromotionArtifactError('archive', 'ZIP archive is too short');
	const eocdOffset = findEocd(archive);
	const diskNumber = archive.readUInt16LE(eocdOffset + 4);
	const centralDisk = archive.readUInt16LE(eocdOffset + 6);
	const entriesOnDisk = archive.readUInt16LE(eocdOffset + 8);
	const totalEntries = archive.readUInt16LE(eocdOffset + 10);
	const centralSize = archive.readUInt32LE(eocdOffset + 12);
	const centralOffset = archive.readUInt32LE(eocdOffset + 16);
	const commentLength = archive.readUInt16LE(eocdOffset + 20);
	if (diskNumber !== 0 || centralDisk !== 0) throw new PromotionArtifactError('archive', 'multi-disk ZIP archives are not supported');
	if (entriesOnDisk !== 1 || totalEntries !== 1) throw new PromotionArtifactError('archive', 'artifact ZIP must contain exactly one entry');
	if (commentLength !== 0 || eocdOffset + 22 !== archive.length) throw new PromotionArtifactError('archive', 'ZIP comments or trailing bytes are not canonical');
	if (centralOffset === 0xffffffff || centralSize === 0xffffffff) throw new PromotionArtifactError('archive', 'ZIP64 archives are not supported');
	if (centralOffset + centralSize !== eocdOffset) throw new PromotionArtifactError('archive', 'central directory boundaries are inconsistent');
	ensureRange(archive, centralOffset, 46, 'central directory');
	if (archive.readUInt32LE(centralOffset) !== CENTRAL_DIRECTORY_HEADER) throw new PromotionArtifactError('archive', 'central directory header signature is invalid');

	const flags = archive.readUInt16LE(centralOffset + 8);
	const compressionMethod = archive.readUInt16LE(centralOffset + 10);
	const crc = archive.readUInt32LE(centralOffset + 16);
	const compressedSize = archive.readUInt32LE(centralOffset + 20);
	const uncompressedSize = archive.readUInt32LE(centralOffset + 24);
	const fileNameLength = archive.readUInt16LE(centralOffset + 28);
	const extraLength = archive.readUInt16LE(centralOffset + 30);
	const fileCommentLength = archive.readUInt16LE(centralOffset + 32);
	const diskStart = archive.readUInt16LE(centralOffset + 34);
	const localOffset = archive.readUInt32LE(centralOffset + 42);
	if ((flags & 0x0001) !== 0) throw new PromotionArtifactError('archive', 'encrypted ZIP entries are not supported');
	if (compressionMethod !== 0 && compressionMethod !== 8) throw new PromotionArtifactError('archive', 'only stored or deflate compression is supported');
	const allowedFlags = 0x0808 | (compressionMethod === 8 ? 0x0006 : 0);
	if ((flags & ~allowedFlags) !== 0) throw new PromotionArtifactError('archive', 'unsupported ZIP general-purpose flags');
	if (compressionMethod === 0 && (flags & 0x0006) !== 0) throw new PromotionArtifactError('archive', 'deflate option flags are invalid for stored entries');
	if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localOffset === 0xffffffff || diskStart === 0xffff) {
		throw new PromotionArtifactError('archive', 'ZIP64 entry metadata is not supported');
	}
	if (diskStart !== 0) throw new PromotionArtifactError('archive', 'entry must start on disk zero');
	if (uncompressedSize > maxUncompressedBytes) throw new PromotionArtifactError('archive', 'inner artifact exceeds the configured size limit');
	const centralVariableSize = fileNameLength + extraLength + fileCommentLength;
	ensureRange(archive, centralOffset + 46, centralVariableSize, 'central directory variable fields');
	if (46 + centralVariableSize !== centralSize) throw new PromotionArtifactError('archive', 'central directory contains unexplained bytes');
	const centralNameBytes = archive.subarray(centralOffset + 46, centralOffset + 46 + fileNameLength);
	const fileName = decodeZipName(centralNameBytes, flags, 'central filename');
	if (fileName !== expectedFileName) throw new PromotionArtifactError('archive', `expected only ${expectedFileName}, received ${fileName}`);
	validateExtraFields(archive.subarray(
		centralOffset + 46 + fileNameLength,
		centralOffset + 46 + fileNameLength + extraLength,
	));
	if (fileCommentLength !== 0) throw new PromotionArtifactError('archive', 'entry comments are not canonical');

	ensureRange(archive, localOffset, 30, 'local header');
	if (archive.readUInt32LE(localOffset) !== LOCAL_FILE_HEADER) throw new PromotionArtifactError('archive', 'local file header signature is invalid');
	const localFlags = archive.readUInt16LE(localOffset + 6);
	const localCompression = archive.readUInt16LE(localOffset + 8);
	const localCrc = archive.readUInt32LE(localOffset + 14);
	const localCompressedSize = archive.readUInt32LE(localOffset + 18);
	const localUncompressedSize = archive.readUInt32LE(localOffset + 22);
	const localNameLength = archive.readUInt16LE(localOffset + 26);
	const localExtraLength = archive.readUInt16LE(localOffset + 28);
	if (localFlags !== flags || localCompression !== compressionMethod) throw new PromotionArtifactError('archive', 'local and central ZIP metadata disagree');
	ensureRange(archive, localOffset + 30, localNameLength + localExtraLength, 'local variable fields');
	const localNameBytes = archive.subarray(localOffset + 30, localOffset + 30 + localNameLength);
	if (!localNameBytes.equals(centralNameBytes)) throw new PromotionArtifactError('archive', 'local and central filenames disagree');
	validateExtraFields(archive.subarray(
		localOffset + 30 + localNameLength,
		localOffset + 30 + localNameLength + localExtraLength,
	));
	const descriptorUsed = (flags & 0x0008) !== 0;
	if (!descriptorUsed && (localCrc !== crc || localCompressedSize !== compressedSize || localUncompressedSize !== uncompressedSize)) {
		throw new PromotionArtifactError('archive', 'local and central size/CRC metadata disagree');
	}
	if (descriptorUsed && !(
		(localCrc === 0 || localCrc === crc)
		&& (localCompressedSize === 0 || localCompressedSize === compressedSize)
		&& (localUncompressedSize === 0 || localUncompressedSize === uncompressedSize)
	)) {
		throw new PromotionArtifactError('archive', 'data-descriptor local metadata is inconsistent');
	}

	const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
	ensureRange(archive, dataOffset, compressedSize, 'compressed payload');
	const compressed = archive.subarray(dataOffset, dataOffset + compressedSize);
	let afterPayload = dataOffset + compressedSize;
	if (descriptorUsed) afterPayload = validateDataDescriptor(archive, afterPayload, crc, compressedSize, uncompressedSize);
	if (afterPayload !== centralOffset) throw new PromotionArtifactError('archive', 'unexplained bytes exist between payload and central directory');

	let output;
	try {
		output = compressionMethod === 0 ? Buffer.from(compressed) : inflateRawSync(compressed, { maxOutputLength: maxUncompressedBytes });
	} catch {
		throw new PromotionArtifactError('archive', 'compressed payload could not be decoded safely');
	}
	if (output.length !== uncompressedSize) throw new PromotionArtifactError('archive', 'uncompressed size does not match central metadata');
	if (crc32(output) !== crc) throw new PromotionArtifactError('archive', 'CRC-32 does not match the inner artifact');
	return output;
}

function validateDataDescriptor(archive, offset, expectedCrc, expectedCompressedSize, expectedUncompressedSize) {
	ensureRange(archive, offset, 12, 'data descriptor');
	let cursor = offset;
	if (archive.readUInt32LE(cursor) === DATA_DESCRIPTOR) {
		cursor += 4;
		ensureRange(archive, cursor, 12, 'data descriptor');
	}
	const crc = archive.readUInt32LE(cursor);
	const compressedSize = archive.readUInt32LE(cursor + 4);
	const uncompressedSize = archive.readUInt32LE(cursor + 8);
	if (crc !== expectedCrc || compressedSize !== expectedCompressedSize || uncompressedSize !== expectedUncompressedSize) {
		throw new PromotionArtifactError('archive', 'data descriptor disagrees with central metadata');
	}
	return cursor + 12;
}

function findEocd(archive) {
	const minimum = Math.max(0, archive.length - MAX_EOCD_SEARCH);
	for (let offset = archive.length - 22; offset >= minimum; offset -= 1) {
		if (archive.readUInt32LE(offset) === END_OF_CENTRAL_DIRECTORY) return offset;
	}
	throw new PromotionArtifactError('archive', 'end-of-central-directory record was not found');
}

function decodeZipName(bytes, flags, path) {
	if ((flags & 0x0800) === 0 && bytes.some(byte => byte > 0x7f)) throw new PromotionArtifactError('archive', `${path} must be ASCII or explicitly UTF-8`);
	try {
		return textDecoder.decode(bytes);
	} catch {
		throw new PromotionArtifactError('archive', `${path} is not valid UTF-8`);
	}
}

function validateExtraFields(bytes) {
	let offset = 0;
	while (offset < bytes.length) {
		if (offset + 4 > bytes.length) throw new PromotionArtifactError('archive', 'ZIP extra field header is truncated');
		const id = bytes.readUInt16LE(offset);
		const size = bytes.readUInt16LE(offset + 2);
		offset += 4;
		if (offset + size > bytes.length) throw new PromotionArtifactError('archive', 'ZIP extra field payload is truncated');
		if (id === 0x0001) throw new PromotionArtifactError('archive', 'ZIP64 extra fields are not supported');
		offset += size;
	}
}

function ensureRange(buffer, offset, length, path) {
	if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || offset + length > buffer.length) {
		throw new PromotionArtifactError('archive', `${path} exceeds archive boundaries`);
	}
}

function toBuffer(value, path) {
	if (Buffer.isBuffer(value)) return value;
	if (value instanceof Uint8Array) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
	throw new PromotionArtifactError(path, 'expected Buffer or Uint8Array');
}

function sha256(bytes) {
	return createHash('sha256').update(bytes).digest('hex');
}

function crc32(bytes) {
	let crc = 0xffffffff;
	for (const byte of bytes) {
		crc ^= byte;
		for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) === 0 ? 0 : 0xedb88320);
	}
	return (crc ^ 0xffffffff) >>> 0;
}
