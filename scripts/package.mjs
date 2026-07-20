import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { writeReleaseIntegrityFiles } from './release-manifest.mjs';

const rootPackage = JSON.parse(readFileSync(resolve('package.json'), 'utf8'));
const version = rootPackage.version;
const out = resolve('release');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const packages = [
	{ directory: 'runtime', name: '@virune/runtime', file: `virune-runtime-${version}.tgz` },
	{ directory: 'compiler', name: '@virune/compiler', file: `virune-compiler-${version}.tgz` },
	{ directory: 'formatter', name: '@virune/formatter', file: `virune-formatter-${version}.tgz` },
	{ directory: 'js-interop', name: '@virune/js-interop', file: `virune-js-interop-${version}.tgz` },
	{ directory: 'stdlib', name: '@virune/stdlib', file: `virune-stdlib-${version}.tgz` },
	{ directory: 'cli', name: 'virune', file: `virune-${version}.tgz` },
];

for (const item of packages) {
	execFileSync('npm', ['pack', `./packages/${item.directory}`, '--pack-destination', out], { stdio: 'inherit' });
	const path = resolve(out, item.file);
	if (!statSync(path).isFile()) throw new Error(`npm pack did not create ${item.file}`);
}

const localPackage = {
	name: 'virune-local-release',
	version,
	private: true,
	type: 'module',
	description: `Local installation bundle for Virune v${version}.`,
	dependencies: Object.fromEntries(packages.map(item => [item.name, `file:./${item.file}`])),
};
writeFileSync(resolve(out, 'package.json'), `${JSON.stringify(localPackage, null, 2)}\n`);
writeFileSync(
	resolve(out, 'README.md'),
	`# Virune v${version} local packages\n\nInstall the complete local toolchain:\n\n\`\`\`bash\nnpm install\nnpx virune --version\nnpx virune init app\nnpx virune run app\n\`\`\`\n\nNode.js 24 or later is the declared supported runtime.\n`,
);
writeFileSync(
	resolve(out, 'README_ja.md'),
	`# Virune v${version} ローカルパッケージ\n\nツールチェーン一式を導入します。\n\n\`\`\`bash\nnpm install\nnpx virune --version\nnpx virune init app\nnpx virune run app\n\`\`\`\n\n対応RuntimeはNode.js 24以上です。\n`,
);
copyFileSync(resolve('THIRD_PARTY_NOTICES.md'), resolve(out, 'THIRD_PARTY_NOTICES.md'));
copyFileSync(resolve('THIRD_PARTY_NOTICES_ja.md'), resolve(out, 'THIRD_PARTY_NOTICES_ja.md'));

const packageEntries = packages.map(item => {
	const bytes = readFileSync(resolve(out, item.file));
	return { file: item.file, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.byteLength };
});
writeFileSync(resolve(out, 'MANIFEST.json'), `${JSON.stringify({ schemaVersion: 1, version, packages: packageEntries }, null, 2)}\n`);
writeReleaseIntegrityFiles(out, version);
