import assert from 'node:assert/strict';
import test from 'node:test';
import { auditNpmPackageFileSet } from './npm-package-contents-policy.mjs';

const manifest = {
	files: ['dist'],
	exports: { '.': './dist/index.js' },
};

function auditWith(extraPath) {
	return auditNpmPackageFileSet({
		manifest,
		files: [
			{ path: 'package.json', size: 2 },
			{ path: 'dist/index.js', size: 1 },
			{ path: extraPath, size: 1 },
		],
		manifestPath: '$.manifest',
		filesPath: '$.files',
	});
}

test('rejects leading ASCII space that Windows strips from path segments', () => {
	assert.throws(
		() => auditWith('dist/ leading.js'),
		/package path segment must not start with ASCII space/u,
	);
});

test('rejects Windows superscript-digit device names', () => {
	for (const path of ['dist/COM¹', 'dist/com².txt', 'dist/LPT³.log']) {
		assert.throws(
			() => auditWith(path),
			/package path segment uses a Windows-reserved name/u,
		);
	}
});

test('rejects remaining Windows DOS device names', () => {
	for (const path of ['dist/COM0', 'dist/lpt0.txt', 'dist/CONIN$', 'dist/conout$.log']) {
		assert.throws(
			() => auditWith(path),
			/package path segment uses a Windows-reserved name/u,
		);
	}
});

test('rejects Windows device basenames normalized before an extension', () => {
	for (const path of ['dist/NUL .txt', 'dist/COM1  .log', 'dist/conout$ .json']) {
		assert.throws(
			() => auditWith(path),
			/package path segment uses a Windows-reserved name/u,
		);
	}
});

test('accepts valid path names adjacent to Windows device-name boundaries', () => {
	for (const path of ['dist/COM10.txt', 'dist/LPT10', 'dist/CONSOLE.js', 'dist/AUXILIARY.js', 'dist/NULSAFE.txt']) {
		const result = auditWith(path);
		assert.equal(result.fileCount, 3);
	}
});
