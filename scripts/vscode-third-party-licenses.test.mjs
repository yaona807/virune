import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { buildBundledThirdPartyLicenseText, collectBundledPackageRoots } from './vscode-third-party-licenses.mjs';

test('bundled third-party license text is deterministic and contains package legal files', async () => {
	await withFixture(async root => {
		writePackage(root, 'zeta', {
			name: 'zeta',
			version: '2.0.0',
			license: 'MIT',
			files: { LICENSE: 'Zeta license\r\n' },
		});
		writePackage(root, '@scope/alpha', {
			name: '@scope/alpha',
			version: '1.0.0',
			license: 'Apache-2.0',
			files: {
				LICENSE: 'Alpha license\n',
				NOTICE: 'Alpha notice\n',
				'ThirdPartyNotices.txt': 'Alpha third-party notices\r\n',
				'THIRD_PARTY_LICENSES.txt': 'Alpha third-party license material\n',
			},
		});
		const metafiles = [{ inputs: {
			'packages/vscode/dist/src/extension.js': {},
			'node_modules/zeta/index.js': {},
			'node_modules/@scope/alpha/lib/index.js': {},
			'node_modules/zeta/helper.js': {},
		} }];
		const text = await buildBundledThirdPartyLicenseText(metafiles, root);
		assert.equal(text, [
			'Virune VS Code Extension — Bundled Third-Party License Texts',
			'',
			'This file is generated from the npm packages whose code is included in the VS Code extension bundles.',
			'It is generated deterministically from esbuild metadata and the installed package legal files.',
			'',
			'===============================================================================',
			'PACKAGE: @scope/alpha@1.0.0',
			'DECLARED LICENSE: Apache-2.0',
			'-------------------------------------------------------------------------------',
			'FILE: LICENSE',
			'',
			'Alpha license',
			'-------------------------------------------------------------------------------',
			'FILE: NOTICE',
			'',
			'Alpha notice',
			'-------------------------------------------------------------------------------',
			'FILE: THIRD_PARTY_LICENSES.txt',
			'',
			'Alpha third-party license material',
			'-------------------------------------------------------------------------------',
			'FILE: ThirdPartyNotices.txt',
			'',
			'Alpha third-party notices',
			'',
			'===============================================================================',
			'PACKAGE: zeta@2.0.0',
			'DECLARED LICENSE: MIT',
			'-------------------------------------------------------------------------------',
			'FILE: LICENSE',
			'',
			'Zeta license',
			'',
		].join('\n'));
	});
});

test('bundled package root discovery handles nested and scoped node_modules paths', () => {
	withFixture(root => {
		const roots = collectBundledPackageRoots([{ inputs: {
			'node_modules/parent/node_modules/@scope/child/index.js': {},
			'node_modules/plain/index.js': {},
			'packages/vscode/src/extension.ts': {},
		} }], root);
		assert.deepEqual(roots, [
			resolve(root, 'node_modules/parent/node_modules/@scope/child'),
			resolve(root, 'node_modules/plain'),
		].sort());
	});
});

test('malformed esbuild metadata fails closed', async () => {
	await withFixture(async root => {
		await assert.rejects(
			() => buildBundledThirdPartyLicenseText([{}], root),
			/Expected esbuild metafile inputs/u,
		);
	});
});

test('empty bundled npm package set fails closed', async () => {
	await withFixture(async root => {
		await assert.rejects(
			() => buildBundledThirdPartyLicenseText([{ inputs: { 'packages/vscode/src/extension.ts': {} } }], root),
			/VS Code bundles did not include any third-party npm packages/u,
		);
	});
});

test('bundled package with absent license metadata fails closed', async () => {
	await withFixture(async root => {
		writePackage(root, 'unknown-license', {
			name: 'unknown-license',
			version: '1.0.0',
			license: undefined,
			files: { LICENSE: 'Some legal text\n' },
		});
		await assert.rejects(
			() => buildBundledThirdPartyLicenseText([{ inputs: { 'node_modules/unknown-license/index.js': {} } }], root),
			/package\.json: license must be a non-empty string/u,
		);
	});
});

test('bundled package with unresolved license declaration fails closed', async () => {
	for (const license of ['UNLICENSED', 'UNKNOWN', 'NOASSERTION', 'NONE', 'SEE LICENSE IN LICENSE']) {
		await withFixture(async root => {
			writePackage(root, 'unresolved-license', {
				name: 'unresolved-license',
				version: '1.0.0',
				license,
				files: { LICENSE: 'Some legal text\n' },
			});
			await assert.rejects(
				() => buildBundledThirdPartyLicenseText([{ inputs: { 'node_modules/unresolved-license/index.js': {} } }], root),
				/must identify a resolved license expression/u,
			);
		});
	}
});

test('bundled package without a license file fails closed', async () => {
	await withFixture(async root => {
		writePackage(root, 'missing-license', {
			name: 'missing-license',
			version: '1.0.0',
			license: 'MIT',
			files: { README: 'No license file here\n' },
		});
		await assert.rejects(
			() => buildBundledThirdPartyLicenseText([{ inputs: { 'node_modules/missing-license/index.js': {} } }], root),
			/Bundled package missing-license@1\.0\.0 does not contain a LICENSE\/LICENCE\/COPYING file/u,
		);
	});
});

test('bundled package with non-UTF-8 legal text fails closed', async () => {
	await withFixture(async root => {
		writePackage(root, 'invalid-utf8-license', {
			name: 'invalid-utf8-license',
			version: '1.0.0',
			license: 'MIT',
			files: { LICENSE: Buffer.from([0xff, 0xfe, 0xfd]) },
		});
		await assert.rejects(
			() => buildBundledThirdPartyLicenseText([{ inputs: { 'node_modules/invalid-utf8-license/index.js': {} } }], root),
			/legal file LICENSE is not valid UTF-8/u,
		);
	});
});

test('duplicate bundled package identity with conflicting legal material fails closed', async () => {
	await withFixture(async root => {
		writePackage(root, 'duplicate-a/node_modules/shared', {
			name: 'shared',
			version: '1.0.0',
			license: 'MIT',
			files: { LICENSE: 'First license text\n' },
		});
		writePackage(root, 'duplicate-b/node_modules/shared', {
			name: 'shared',
			version: '1.0.0',
			license: 'MIT',
			files: { LICENSE: 'Different license text\n' },
		});
		await assert.rejects(
			() => buildBundledThirdPartyLicenseText([{ inputs: {
				'node_modules/duplicate-a/node_modules/shared/index.js': {},
				'node_modules/duplicate-b/node_modules/shared/index.js': {},
			} }], root),
			/Bundled package shared@1\.0\.0 has inconsistent legal metadata across installations/u,
		);
	});
});

function writePackage(root, packagePath, { name, version, license, files }) {
	const directory = resolve(root, 'node_modules', ...packagePath.split('/'));
	mkdirSync(directory, { recursive: true });
	writeFileSync(resolve(directory, 'package.json'), `${JSON.stringify({ name, version, license }, null, 2)}\n`);
	for (const [fileName, content] of Object.entries(files)) writeFileSync(resolve(directory, fileName), content);
}

function withFixture(run) {
	const root = mkdtempSync(join(tmpdir(), 'virune-vscode-license-'));
	try {
		const result = run(root);
		if (result?.then !== undefined) return result.finally(() => rmSync(root, { recursive: true, force: true }));
		rmSync(root, { recursive: true, force: true });
		return result;
	} catch (error) {
		rmSync(root, { recursive: true, force: true });
		throw error;
	}
}
