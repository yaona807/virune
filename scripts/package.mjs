import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { writeReleaseIntegrityFiles } from './release-manifest.mjs';

const rootPackage = JSON.parse(readFileSync(resolve('package.json'), 'utf8'));
const version = rootPackage.version;
const out = resolve('release');
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const internalPackages = [
	{ directory: 'runtime', name: '@virune/runtime', file: `virune-runtime-${version}.tgz` },
	{ directory: 'compiler', name: '@virune/compiler', file: `virune-compiler-${version}.tgz` },
	{ directory: 'formatter', name: '@virune/formatter', file: `virune-formatter-${version}.tgz` },
	{ directory: 'js-interop', name: '@virune/js-interop', file: `virune-js-interop-${version}.tgz` },
	{ directory: 'stdlib', name: '@virune/stdlib', file: `virune-stdlib-${version}.tgz` },
];
const cliPackage = { directory: 'cli', name: 'virune', file: `virune-${version}.tgz` };
const packages = [...internalPackages, cliPackage];

const pack = directory => {
	execFileSync(npmCommand, ['pack', directory, '--pack-destination', out], { stdio: 'inherit' });
};

for (const item of internalPackages) {
	pack(`./packages/${item.directory}`);
	const path = resolve(out, item.file);
	if (!statSync(path).isFile()) throw new Error(`npm pack did not create ${item.file}`);
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

	const internalTarballs = internalPackages.map(item => resolve(out, item.file));
	execFileSync(
		npmCommand,
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
	description: `Local installation bundle for Virune v${version}.`,
	dependencies: { virune: `file:./${cliPackage.file}` },
};
writeFileSync(resolve(out, 'package.json'), `${JSON.stringify(localPackage, null, 2)}\n`);
writeFileSync(
	resolve(out, 'README.md'),
	`# Virune v${version} release packages\n\nVirune is not published to the npm Registry. The CLI tarball contains its complete dependency tree and can be installed directly with npm.\n\nInstall from this directory:\n\n\`\`\`bash\nnpm install --global ./${cliPackage.file}\nvirune --version\n\`\`\`\n\nInstall from GitHub Releases:\n\n\`\`\`bash\nnpm install --global ${releaseAssetBase}/${cliPackage.file}\n\`\`\`\n\nFor a project-local installation, omit \`--global\` and add \`--save-dev\`. Node.js 24 or later is required.\n`,
);
writeFileSync(
	resolve(out, 'README_ja.md'),
	`# Virune v${version} リリースパッケージ\n\nViruneはnpm Registryへ公開しません。CLI tarballには依存関係一式が含まれており、npmから直接インストールできます。\n\nこのディレクトリからインストールします。\n\n\`\`\`bash\nnpm install --global ./${cliPackage.file}\nvirune --version\n\`\`\`\n\nGitHub Releasesからインストールします。\n\n\`\`\`bash\nnpm install --global ${releaseAssetBase}/${cliPackage.file}\n\`\`\`\n\nプロジェクト単位で導入する場合は\`--global\`を外し、\`--save-dev\`を指定します。Node.js 24以上が必要です。\n`,
);
copyFileSync(resolve('THIRD_PARTY_NOTICES.md'), resolve(out, 'THIRD_PARTY_NOTICES.md'));
copyFileSync(resolve('THIRD_PARTY_NOTICES_ja.md'), resolve(out, 'THIRD_PARTY_NOTICES_ja.md'));

const packageEntries = packages.map(item => {
	const bytes = readFileSync(resolve(out, item.file));
	return { file: item.file, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.byteLength };
});
writeFileSync(resolve(out, 'MANIFEST.json'), `${JSON.stringify({ schemaVersion: 1, version, packages: packageEntries }, null, 2)}\n`);
writeReleaseIntegrityFiles(out, version);
