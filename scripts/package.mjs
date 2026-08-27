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
const registryPackages = [...internalPackages, registryCliPackage];
const cliPackage = { directory: 'cli', name: 'virune', file: bundledCliReleaseAssetName(version) };
const packages = [...registryPackages, cliPackage];

const pack = directory => {
	execNpmSync(['pack', '--ignore-scripts', directory, '--pack-destination', out], { stdio: 'inherit' });
};

const stampCliVersion = directory => {
	const cliEntryPath = resolve(directory, 'dist/src/main.js');
	const cliEntry = readFileSync(cliEntryPath, 'utf8');
	const versionDeclaration = /const VERSION = ['"][^'"]+['"];/gu;
	const matches = [...cliEntry.matchAll(versionDeclaration)];
	if (matches.length !== 1) throw new Error(`Packaged CLI must contain exactly one VERSION declaration; found ${matches.length}.`);
	writeFileSync(cliEntryPath, cliEntry.replace(matches[0][0], `const VERSION = ${JSON.stringify(version)};`));
};

const stageRegistryPackage = item => {
	const stagingRoot = mkdtempSync(join(tmpdir(), `virune-registry-${item.directory}-release-`));
	const stagingPackage = resolve(stagingRoot, 'package');
	try {
		cpSync(resolve('packages', item.directory), stagingPackage, { recursive: true });
		const stagingManifestPath = resolve(stagingPackage, 'package.json');
		const stagingManifest = JSON.parse(readFileSync(stagingManifestPath, 'utf8'));
		if (stagingManifest.private !== true) throw new Error(`Registry source workspace ${item.name} must remain private:true.`);
		if (stagingManifest.publishConfig !== undefined) throw new Error(`Registry source workspace ${item.name} must not define publishConfig.`);
		delete stagingManifest.private;
		writeFileSync(stagingManifestPath, `${JSON.stringify(stagingManifest, null, '\t')}\n`);
		if (item.name === 'virune') stampCliVersion(stagingPackage);
		execNpmSync(['pack', '--ignore-scripts', stagingPackage, '--pack-destination', stagingRoot], { stdio: 'inherit' });
		const npmPackedFile = item.name === 'virune' ? bundledCliReleaseAssetName(version) : item.file;
		const packedPath = resolve(stagingRoot, npmPackedFile);
		if (!statSync(packedPath).isFile()) throw new Error(`npm pack did not create ${npmPackedFile}`);
		copyFileSync(packedPath, resolve(out, item.file));
	} finally {
		rmSync(stagingRoot, { recursive: true, force: true });
	}
};

for (const item of registryPackages) stageRegistryPackage(item);

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
	stampCliVersion(stagingPackage);

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
copyFileSync(resolve('LICENSE'), resolve(out, 'LICENSE'));
copyFileSync(resolve('NOTICE'), resolve(out, 'NOTICE'));
copyFileSync(resolve('THIRD_PARTY_NOTICES.md'), resolve(out, 'THIRD_PARTY_NOTICES.md'));

const packageEntries = packages.map(item => {
	const bytes = readFileSync(resolve(out, item.file));
	return { file: item.file, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.byteLength };
});
writeFileSync(resolve(out, 'MANIFEST.json'), `${JSON.stringify({ schemaVersion: 1, version, packages: packageEntries }, null, 2)}\n`);
const publicationIdentity = writeNpmPublicationIdentity({ releaseDirectory: out });
const registryDistributionEnabled = publicationIdentity.registryVersionEligible === true && publicationIdentity.publicationReady === true;

if (registryDistributionEnabled) {
	writeFileSync(
		resolve(out, 'README.md'),
		`# Virune v${version} release packages\n\nThe public npm Registry is the canonical package distribution for this Virune release.\n\nInstall the exact CLI version from npm:\n\n\`\`\`bash\nnpm install --global virune@${version}\nvirune --version\n\`\`\`\n\nFor a one-shot exact-version invocation:\n\n\`\`\`bash\nnpx --yes virune@${version} --version\n\`\`\`\n\nGitHub Releases retain the reviewed release artifacts, checksums, SBOM, attestations, and bundled CLI tarball for archive and verification purposes. The bundled tarball is not the canonical package installation channel for Registry-enabled releases. Node.js 24 or later is required. Verify downloaded GitHub release files with \`SHA256SUMS\`, \`RELEASE-MANIFEST.json\`, and the GitHub artifact attestation.\n`,
	);
	writeFileSync(
		resolve(out, 'README_ja.md'),
		`# Virune v${version} リリースパッケージ\n\nこのViruneリリースでは、public npm Registryを正式なpackage配布経路とします。\n\nnpmからexact versionのCLIをインストールします。\n\n\`\`\`bash\nnpm install --global virune@${version}\nvirune --version\n\`\`\`\n\nexact versionを1回だけ実行する場合は、次のようにします。\n\n\`\`\`bash\nnpx --yes virune@${version} --version\n\`\`\`\n\nGitHub Releasesには、review済みrelease artifact、checksum、SBOM、attestation、archive・検証用のbundled CLI tarballを残します。Registry-enabled releaseでは、bundled tarballを正式なpackage install経路として扱いません。Node.js 24以上が必要です。GitHub Releaseからdownloadしたfileは、\`SHA256SUMS\`、\`RELEASE-MANIFEST.json\`、GitHub artifact attestationで検証してください。\n`,
	);
} else {
	writeFileSync(
		resolve(out, 'README.md'),
		`# Virune v${version} release packages\n\nVirune is not published to the npm Registry. The CLI tarball contains its complete dependency tree and can be installed directly with npm.\n\nInstall from this directory:\n\n\`\`\`bash\nnpm install --global ./${cliPackage.file}\nvirune --version\n\`\`\`\n\nInstall from GitHub Releases:\n\n\`\`\`bash\nnpm install --global ${releaseAssetBase}/${cliPackage.file}\n\`\`\`\n\nFor a project-local installation, omit \`--global\` and add \`--save-dev\`. Node.js 24 or later is required. Verify downloaded files with \`SHA256SUMS\`, \`RELEASE-MANIFEST.json\`, and the GitHub artifact attestation before installation.\n`,
	);
	writeFileSync(
		resolve(out, 'README_ja.md'),
		`# Virune v${version} リリースパッケージ\n\nViruneはnpm Registryへ公開しません。CLI tarballには依存関係一式が含まれており、npmから直接インストールできます。\n\nこのディレクトリからインストールします。\n\n\`\`\`bash\nnpm install --global ./${cliPackage.file}\nvirune --version\n\`\`\`\n\nGitHub Releasesからインストールします。\n\n\`\`\`bash\nnpm install --global ${releaseAssetBase}/${cliPackage.file}\n\`\`\`\n\nプロジェクト単位で導入する場合は\`--global\`を外し、\`--save-dev\`を指定します。Node.js 24以上が必要です。インストール前に\`SHA256SUMS\`、\`RELEASE-MANIFEST.json\`、GitHub artifact attestationを使用してdownload fileを検証してください。\n`,
	);
}

writeReleaseIntegrityFiles(out, version);
verifyReleaseLicenseArtifacts();
