import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { collectAnchors, hashDirectory, renderGrammar, renderMarkdown, resolveReferenceIdentity } from './build-reference.mjs';

const SOURCE_SHA = '0123456789abcdef0123456789abcdef01234567';

function context(resolveLink = target => target) {
	return {
		sourcePath: 'spec/test.md',
		outputPath: 'test.html',
		anchors: new Set(),
		resolveLink,
	};
}

test('stable Reference identity is bound to the exact package tag', () => {
	assert.deepEqual(resolveReferenceIdentity({
		mode: 'stable',
		packageVersion: '1.2.3',
		languageVersion: '1.0',
		releaseTag: 'v1.2.3',
		sourceSha: SOURCE_SHA,
	}), {
		mode: 'stable',
		version: '1.2.3',
		languageVersion: '1.0',
		releaseTag: 'v1.2.3',
		sourceSha: SOURCE_SHA,
	});
	assert.throws(() => resolveReferenceIdentity({
		mode: 'stable', packageVersion: '1.2.3', languageVersion: '1.0', releaseTag: 'v1.2.4', sourceSha: SOURCE_SHA,
	}), /tag mismatch/u);
	assert.throws(() => resolveReferenceIdentity({
		mode: 'stable', packageVersion: '1.2.3-rc.1', languageVersion: '1.0', releaseTag: 'v1.2.3-rc.1', sourceSha: SOURCE_SHA,
	}), /prerelease/u);
});

test('Reference rendering escapes raw HTML instead of executing it', () => {
	for (const source of ['<script>alert("x")</script>', '<SCRIPT>alert("x")</SCRIPT>']) {
		const html = renderMarkdown(source, context());
		assert.match(html, /^<p>&lt;[A-Za-z]+&gt;alert\(&quot;x&quot;\)&lt;\/[A-Za-z]+&gt;<\/p>$/u);
		assert.doesNotMatch(html, /<script\b/iu);
	}
});

test('Reference grammar heading uses the generated locale title', () => {
	assert.match(renderGrammar('Module = "main";\n', '規範文法'), /^<h1 id="grammar\.complete">規範文法<\/h1>\n/u);
});

test('Reference rendering fails closed on a broken link', () => {
	assert.throws(() => renderMarkdown('[missing](missing.md)', context(target => {
		throw new Error(`broken ${target}`);
	})), /broken missing\.md/u);
});

test('Reference anchors reject duplicate rule IDs', () => {
	assert.throws(() => collectAnchors('## `[type.same]` First\n\n`[type.same]` Second\n', 'spec/test.md'), /duplicate anchor type\.same/u);
});

test('Reference directory hash is independent of file creation order', async () => {
	const root = await mkdtemp(join(tmpdir(), 'virune-reference-hash-'));
	try {
		const first = join(root, 'first');
		const second = join(root, 'second');
		await mkdir(first); await mkdir(second);
		await writeFile(join(first, 'a.html'), 'a\n');
		await writeFile(join(first, 'b.html'), 'b\n');
		await writeFile(join(second, 'b.html'), 'b\n');
		await writeFile(join(second, 'a.html'), 'a\n');
		assert.equal(await hashDirectory(first), await hashDirectory(second));
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
