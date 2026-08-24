import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { verifyNpmPackageContents } from './verify-npm-package-contents.mjs';

const baseManifest = {
  name: '@virune/example',
  version: '1.0.0',
  private: true,
  files: ['dist'],
  exports: { '.': './dist/index.js' },
};
const basePack = {
  name: '@virune/example',
  version: '1.0.0',
  bundled: [],
  entryCount: 3,
  files: [
    { path: 'dist/index.d.ts', size: 12 },
    { path: 'dist/index.js', size: 20 },
    { path: 'package.json', size: 100 },
  ],
};

test('accepts a canonical planned package dry-run and returns deterministic evidence', () => {
  withFixture(({ root }) => {
    const result = verifyNpmPackageContents(root, { packDryRun: () => structuredClone(basePack) });
    assert.equal(result.schemaVersion, 1);
    assert.equal(result.stage, 'prepublication-package-contents-audit');
    assert.equal(result.version, '1.0.0');
    assert.equal(result.packageCount, 1);
    assert.deepEqual(result.packages.map(item => item.registryName), ['@virune/example']);
    assert.match(result.packages[0].fileSetSha256, /^[0-9a-f]{64}$/u);
    assert.equal(result.packages[0].fileCount, 3);
    assert.equal(result.packages[0].unpackedBytes, 132);
  });
});

test('derives Registry identity from workspace identity and rejects duplicated package metadata', () => {
  withFixture(({ root, planPath }) => {
    writeJson(planPath, {
      packages: [{ directory: 'example', workspaceName: '@virune/example', registryName: '@virune/example' }],
    });
    assert.throws(
      () => verifyNpmPackageContents(root, { packDryRun: () => structuredClone(basePack) }),
      /\$\.packages\[0\]: expected keys directory, workspaceName/u,
    );
  });
});

test('canonicalizes npm pack file order before producing evidence', () => {
  withFixture(({ root }) => {
    const forward = verifyNpmPackageContents(root, { packDryRun: () => structuredClone(basePack) });
    const reversedPack = structuredClone(basePack);
    reversedPack.files.reverse();
    const reversed = verifyNpmPackageContents(root, { packDryRun: () => reversedPack });
    assert.deepEqual(reversed, forward);
  });
});

test('uses real npm pack dry-run JSON without creating a tarball', () => {
  withFixture(({ root, packageRoot }) => {
    mkdirSync(resolve(packageRoot, 'dist'), { recursive: true });
    writeFileSync(resolve(packageRoot, 'dist/index.js'), 'export const value = 1;\n');
    writeFileSync(resolve(packageRoot, 'dist/index.d.ts'), 'export declare const value: number;\n');
    const result = verifyNpmPackageContents(root);
    assert.equal(result.packageCount, 1);
    assert.equal(result.packages[0].registryName, '@virune/example');
    assert.equal(result.packages[0].fileCount, 3);
  });
});

test('fails closed on files outside the manifest files allowlist', () => {
  withFixture(({ root }) => {
    const pack = structuredClone(basePack);
    pack.files.push({ path: 'src/index.js', size: 1 });
    pack.entryCount += 1;
    assert.throws(() => verifyNpmPackageContents(root, { packDryRun: () => pack }), /unexpected file outside package\.json files allowlist: src\/index\.js/u);
  });
});

test('fails closed when an allowlist entry selects no packed file', () => {
  withFixture(({ root, manifestPath }) => {
    writeJson(manifestPath, { ...baseManifest, files: ['dist', 'README.md'] });
    assert.throws(() => verifyNpmPackageContents(root, { packDryRun: () => structuredClone(basePack) }), /allowlist entry does not select any packed file: README\.md/u);
  });
});

test('fails closed on unsupported globbed files rules or wildcard package targets', () => {
  withFixture(({ root, manifestPath }) => {
    writeJson(manifestPath, { ...baseManifest, files: ['dist/*'] });
    assert.throws(() => verifyNpmPackageContents(root, { packDryRun: () => structuredClone(basePack) }), /globbed files entries are not supported/u);
  });
  withFixture(({ root, manifestPath }) => {
    writeJson(manifestPath, { ...baseManifest, exports: { './*': './dist/*.js' } });
    assert.throws(() => verifyNpmPackageContents(root, { packDryRun: () => structuredClone(basePack) }), /wildcard package targets require explicit audit support/u);
  });
});

test('fails closed when exports or bin targets are absent from the packed file set', () => {
  withFixture(({ root, manifestPath }) => {
    writeJson(manifestPath, { ...baseManifest, exports: { '.': './dist/missing.js' } });
    assert.throws(() => verifyNpmPackageContents(root, { packDryRun: () => structuredClone(basePack) }), /target is missing from npm pack contents: \.\/dist\/missing\.js/u);
  });
  withFixture(({ root, manifestPath }) => {
    writeJson(manifestPath, { ...baseManifest, bin: { example: './dist/cli.js' } });
    assert.throws(() => verifyNpmPackageContents(root, { packDryRun: () => structuredClone(basePack) }), /target is missing from npm pack contents: \.\/dist\/cli\.js/u);
  });
});

test('fails closed on bundled dependencies', () => {
  withFixture(({ root }) => {
    const pack = structuredClone(basePack);
    pack.bundled = ['@virune/runtime'];
    assert.throws(() => verifyNpmPackageContents(root, { packDryRun: () => pack }), /registry package dry-run must not bundle dependencies/u);
  });
});

test('fails closed on non-canonical, development-only, raw source, nested dependency, credential-like, or nonportable paths', () => {
  for (const badPath of [
    'dist/../secret.js',
    'dist/test/helper.js',
    'dist/fixture/helper.js',
    'dist/__fixtures__/helper.js',
    'dist/index.test.js',
    'dist/helper.test.cjs.map',
    'dist/schema.spec.json',
    'dist/control\nname.js',
    'dist/.env.production',
    'dist/node_modules/dependency.js',
    'dist/source.ts',
    'dist/private.pem',
    'dist/trailing/',
    'dist/index.js/child.js',
    'dist/INDEX.js/child.js',
    'dist/Index.js',
    'dist/cafe\u0301.js',
    'dist/trailing-dot.',
    'dist/trailing-space ',
    'dist/bad:name.js',
    'dist/bad?.js',
    'dist/CON.js',
    'dist/NUL',
    'dist/COM1.txt',
  ]) {
    withFixture(({ root }) => {
      const pack = structuredClone(basePack);
      pack.files.push({ path: badPath, size: 1 });
      pack.entryCount += 1;
      assert.throws(() => verifyNpmPackageContents(root, { packDryRun: () => pack }));
    });
  }
});

test('fails closed on npm pack identity or duplicate path drift', () => {
  withFixture(({ root }) => {
    const pack = structuredClone(basePack);
    pack.name = '@virune/not-example';
    assert.throws(() => verifyNpmPackageContents(root, { packDryRun: () => pack }), /npmPack\.name/u);
  });
  withFixture(({ root }) => {
    const pack = structuredClone(basePack);
    pack.files.push({ path: 'dist/index.js', size: 20 });
    pack.entryCount += 1;
    assert.throws(() => verifyNpmPackageContents(root, { packDryRun: () => pack }), /duplicate path dist\/index\.js/u);
  });
});

function withFixture(run) {
  const root = mkdtempSync(join(tmpdir(), 'virune-npm-package-audit-'));
  const packageRoot = resolve(root, 'packages/example');
  const manifestPath = resolve(packageRoot, 'package.json');
  const planPath = resolve(root, '.github/release/npm-publication-v1.json');
  try {
    mkdirSync(resolve(root, '.github/release'), { recursive: true });
    mkdirSync(packageRoot, { recursive: true });
    writeJson(resolve(root, 'package.json'), { name: 'fixture-root', version: '1.0.0', private: true });
    writeJson(planPath, {
      packages: [{ directory: 'example', workspaceName: '@virune/example' }],
    });
    writeJson(manifestPath, baseManifest);
    run({ root, packageRoot, manifestPath, planPath });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}
