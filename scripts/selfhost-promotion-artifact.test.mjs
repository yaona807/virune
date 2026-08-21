import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { deflateRawSync } from 'node:zlib';
import { readCanonicalJsonArtifactZip } from './selfhost-promotion-artifact.mjs';

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

function zipSingle(text, {
	fileName = 'observation.json',
	descriptor = false,
	compressionMethod = 0,
	compressionOptionBits = 0,
} = {}) {
	const name = Buffer.from(fileName, 'utf8');
	const payload = Buffer.from(text, 'utf8');
	const compressed = compressionMethod === 8 ? deflateRawSync(payload) : payload;
	const crc = crc32(payload);
	const flags = 0x0800 | (descriptor ? 0x0008 : 0) | compressionOptionBits;
	const local = Buffer.alloc(30);
	local.writeUInt32LE(0x04034b50, 0);
	local.writeUInt16LE(20, 4);
	local.writeUInt16LE(flags, 6);
	local.writeUInt16LE(compressionMethod, 8);
	local.writeUInt32LE(descriptor ? 0 : crc, 14);
	local.writeUInt32LE(descriptor ? 0 : compressed.length, 18);
	local.writeUInt32LE(descriptor ? 0 : payload.length, 22);
	local.writeUInt16LE(name.length, 26);
	const dataDescriptor = descriptor ? Buffer.alloc(16) : Buffer.alloc(0);
	if (descriptor) {
		dataDescriptor.writeUInt32LE(0x08074b50, 0);
		dataDescriptor.writeUInt32LE(crc, 4);
		dataDescriptor.writeUInt32LE(compressed.length, 8);
		dataDescriptor.writeUInt32LE(payload.length, 12);
	}
	const centralOffset = local.length + name.length + compressed.length + dataDescriptor.length;
	const central = Buffer.alloc(46);
	central.writeUInt32LE(0x02014b50, 0);
	central.writeUInt16LE(20, 4);
	central.writeUInt16LE(20, 6);
	central.writeUInt16LE(flags, 8);
	central.writeUInt16LE(compressionMethod, 10);
	central.writeUInt32LE(crc, 16);
	central.writeUInt32LE(compressed.length, 20);
	central.writeUInt32LE(payload.length, 24);
	central.writeUInt16LE(name.length, 28);
	central.writeUInt32LE(0, 42);
	const centralSize = central.length + name.length;
	const eocd = Buffer.alloc(22);
	eocd.writeUInt32LE(0x06054b50, 0);
	eocd.writeUInt16LE(1, 8);
	eocd.writeUInt16LE(1, 10);
	eocd.writeUInt32LE(centralSize, 12);
	eocd.writeUInt32LE(centralOffset, 16);
	return Buffer.concat([local, name, compressed, dataDescriptor, central, name, eocd]);
}

function read(archive, overrides = {}) {
	return readCanonicalJsonArtifactZip({
		archiveBytes: archive,
		providerDigest: `sha256:${sha256(archive)}`,
		expectedFileName: 'observation.json',
		...overrides,
	});
}

test('accepts a byte-canonical single-file JSON ZIP and separates archive and inner digests', () => {
	const archive = zipSingle('{"version":2,"ok":true}');
	const result = read(archive);
	assert.deepEqual(result.value, { version: 2, ok: true });
	assert.equal(result.archiveSha256, sha256(archive));
	assert.equal(result.bytesSha256, sha256(Buffer.from('{"version":2,"ok":true}')));
	assert.notEqual(result.archiveSha256, result.bytesSha256);
});

test('accepts a signed data descriptor while validating its CRC and sizes', () => {
	const archive = zipSingle('{"version":2}', { descriptor: true });
	assert.deepEqual(read(archive).value, { version: 2 });
});

test('accepts canonical deflate compression option bits', () => {
	for (const compressionOptionBits of [0x0002, 0x0004, 0x0006]) {
		const archive = zipSingle('{"version":2,"compressed":true}', { compressionMethod: 8, compressionOptionBits });
		assert.deepEqual(read(archive).value, { version: 2, compressed: true });
	}
});

test('rejects deflate-only option bits on a stored entry', () => {
	const archive = zipSingle('{"version":2}', { compressionMethod: 0, compressionOptionBits: 0x0002 });
	assert.throws(() => read(archive), /deflate option flags are invalid for stored entries/u);
});

test('rejects unrelated general-purpose ZIP flags', () => {
	const archive = zipSingle('{"version":2}');
	const mutated = Buffer.from(archive);
	mutated.writeUInt16LE(mutated.readUInt16LE(6) | 0x0020, 6);
	const centralOffset = mutated.length - 22 - (46 + Buffer.byteLength('observation.json'));
	mutated.writeUInt16LE(mutated.readUInt16LE(centralOffset + 8) | 0x0020, centralOffset + 8);
	assert.throws(() => read(mutated), /unsupported ZIP general-purpose flags/u);
});

test('rejects a provider digest that does not match downloaded archive bytes', () => {
	const archive = zipSingle('{"version":2}');
	assert.throws(
		() => read(archive, { providerDigest: `sha256:${'0'.repeat(64)}` }),
		/provider archive digest does not match downloaded bytes/u,
	);
});

test('rejects non-canonical JSON bytes instead of trimming or normalizing them', () => {
	const archive = zipSingle('{"version":2}\n');
	assert.throws(() => read(archive), /byte-exact canonical JSON serialization/u);
});

test('rejects a mismatched or traversal-like inner filename', () => {
	const archive = zipSingle('{"version":2}', { fileName: '../observation.json' });
	assert.throws(() => read(archive), /expected only observation\.json/u);
});

test('rejects archives claiming more than one entry', () => {
	const archive = zipSingle('{"version":2}');
	const mutated = Buffer.from(archive);
	const eocd = mutated.length - 22;
	mutated.writeUInt16LE(2, eocd + 8);
	mutated.writeUInt16LE(2, eocd + 10);
	assert.throws(() => read(mutated), /exactly one entry/u);
});

test('rejects payload corruption even when the ZIP container remains parseable', () => {
	const archive = zipSingle('{"version":2}');
	const mutated = Buffer.from(archive);
	const payloadOffset = 30 + Buffer.byteLength('observation.json');
	mutated[payloadOffset] ^= 1;
	assert.throws(() => read(mutated), /CRC-32 does not match/u);
});
