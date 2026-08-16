import { createHash } from 'node:crypto';
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execNpmSync } from './npm-cli.mjs';
import { bundledCliReleaseAssetName, registryReleaseAssetNameForPackage, writeNpmPublicationIdentity } from './verify-npm-publication-identity.mjs';
import { writeReleaseIntegrityFiles } from './release-manifest.mjs';
import { verifyReleaseLicenseArtifacts } from './verify-release-license-artifacts.mjs';
import { verifyRepositoryLicensePolicy } from './verify-repository-license-policy.mjs';

verifyRepositoryLicensePolicy();

const rootPackage = JSON.parse(readFileSync(resolve('package.json'), 'utf8'));
const version = rootPackage.version;
const out = resolve('release');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const internalPackages = [
	{ directory: 'runtime', name: '@virune/runtime' },
	{ directory: 'compiler', name: '@virune/compiler' },
	{ directory: 'formatter', name: '@virune/formatter' },
	{ directory: 'js-interop', name: '@virune/js-interop' },
	{ directory: 'stdlib', name: '@virune/stdlib' },
].map(item => ({ ...item, file: registryReleaseAssetNameForPackage(item.name, version) }));
const registryCliPackage = { directory: 'cli', name: 'virune', file: registryReleaseAssetNameForPackage('virune', version) };
const cliPackage = { directory: 'cli', name: 'virune', file: bundledCliReleaseAssetName(version) };
const packages = [...internalPackages, registryCliPackage, cliPackage];

const pack = directory => {
	execNpmSync(['pack', directory, '--pack-destination', out], { stdio: 'inherit' });
};

for (const item of internalPackages) {
	pack(`./packages/${item.directory}`);
	const path = resolve(out, item.file);
	if (!statSync(path).isFile()) throw new Error(`npm pack did not create ${item.file}`);
}

const registryCliStagingRoot = mkdtempSync(join(tmpdir(), 'virune-registry-cli-release-'));
try {
	execNpmSync(['pack', './packages/cli', '--pack-destination', registryCliStagingRoot], { stdio: 'inherit' });
	const packedCli = resolve(registryCliStagingRoot, bundledCliReleaseAssetName(version));
	if (!statSync(packedCli).isFile()) throw new Error(`npm pack did not create ${bundledCliReleaseAssetName(version)}`);
	copyFileSync(packedCli, resolve(out, registryCliPackage.file));
} finally {
	rmSync(registryCliStagingRoot, { recursive: true, force: true });
}

const stagingRoot = mkdtempSync(join(tmpdir(), 'virune-cli-release-'));
const stagingPackage = resolve(stagingRoot, 'package');
try {
	cpSync(resolve('packages/cli'), stagingPackage, { recursive: true });
	const stagingManifestPath = resolve(stagingPackage, 'package.json');
	const stagingManifest = JSON.parse(readFileSync(stagingManifestPath, 'utf8'));
	stagingManifest.private = true;
	delete stagingManifest.publishConfig;
	stagingManifest.bundledDependencies = Object.keys(stagingManifest.dependencies ?? {}).sort();
	writeFileSync(stagingManifestPath, `${JSON.stringify(stagingManifest, null, '\t')}\n`);

	const stagingCliEntryPath = resolve(stagingPackage, 'dist/src/main.js');
	const stagingCliEntry = readFileSync(stagingCliEntryPath, 'utf8');
	const versionDeclaration = /const VERSION = ['"][^'"]+['"];/u;
	if (!versionDeclaration.test(stagingCliEntry)) throw new Error('Packaged CLI version declaration was not found.');
	writeFileSync(stagingCliEntryPath, stagingCliEntry.replace(versionDeclaration, `const VERSION = ${JSON.stringify(version)};`));

	const internalTarballs = internalPackages.map(item => resolve(out, item.file));
	execNpmSync(
		[
			'install',
			'--no-save',
			'--ignore-scripts',
			'--package-lock=false',
			'--no-audit',
			'--no-fund',
			'--install-links=false',
			...internalTarballs,
		],
		{ cwd: stagingPackage, stdio: 'inherit' },
	);
	pack(stagingPackage);
} finally {
	rmSync(stagingRoot, { recursive: true, force: true });
}

const cliTarballPath = resolve(out, cliPackage.file);
if (!statSync(cliTarballPath).isFile()) throw new Error(`npm pack did not create ${cliPackage.file}`);

const releaseAssetBase = `https://github.com/yaona807/virune/releases/download/v${version}`;
const localPackage = {
	name: 'virune-local-release',
	version,
	private: true,
	type: 'module',
	license: rootPackage.license,
	description: `Local installation bundle for Virune v${version}.`,
	dependencies: { virune: `file:./${cliPackage.file}` },
};
writeFileSync(resolve(out, 'package.json'), `${JSON.stringify(localPackage, null, 2)}\n`);
writeFileSync(
	resolve(out, 'README.md'),
	`# Virune v${version} release packages\n\nVirune is not published to the npm Registry. The CLI tarball contains its complete dependency tree and can be installed directly with npm.\n\nInstall from this directory:\n\n\`\`\`bash\nnpm install --global ./${cliPackage.file}\nvirune --version\n\`\`\`\n\nInstall from GitHub Releases:\n\n\`\`\`bash\nnpm install --global ${releaseAssetBase}/${cliPackage.file}\n\`\`\`\n\nFor a project-local installation, omit \`--global\` and add \`--save-dev\`. Node.js 24 or later is required. Verify downloaded files with \`SHA256SUMS\`, \`RELEASE-MANIFEST.json\`, and the GitHub artifact attestation before installation.\n`,
);
writeFileSync(
	resolve(out, 'README_ja.md'),
	`# Virune v${version} リリースパッケージ\n\nViruneはnpm Registryへ公開しません。CLI tarballには依存関係一式が含まれており、npmから直接インストールできます。\n\nこのディレクトリからインストールします。\n\n\`\`\`bash\nnpm install --global ./${cliPackage.file}\nvirune --version\n\`\`\`\n\nGitHub Releasesからインストールします。\n\n\`\`\`bash\nnpm install --global ${releaseAssetBase}/${cliPackage.file}\n\`\`\`\n\nプロジェクト単位で導入する場合は\`--global\`を外し、\`--save-dev\`を指定します。Node.js 24以上が必要です。インストール前に\`SHA256SUMS\`、\`RELEASE-MANIFEST.json\`、GitHub artifact attestationを使用してdownload fileを検証してください。\n`,
);
copyFileSync(resolve('LICENSE'), resolve(out, 'LICENSE'));
copyFileSync(resolve('NOTICE'), resolve(out, 'NOTICE'));
copyFileSync(resolve('THIRD_PARTY_NOTICES.md'), resolve(out, 'THIRD_PARTY_NOTICES.md'));
copyFileSync(resolve('THIRD_PARTY_NOTICES_ja.md'), resolve(out, 'THIRD_PARTY_NOTICES_ja.md'));

const packageEntries = packages.map(item => {
	const bytes = readFileSync(resolve(out, item.file));
	return { file: item.file, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.byteLength };
});
writeFileSync(resolve(out, 'MANIFEST.json'), `${JSON.stringify({ schemaVersion: 1, version, packages: packageEntries }, null, 2)}\n`);
writeNpmPublicationIdentity({ releaseDirectory: out });
writeReleaseIntegrityFiles(out, version);
verifyReleaseLicenseArtifacts();
