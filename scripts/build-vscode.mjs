import { mkdir, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { buildBundledThirdPartyLicenseText } from './vscode-third-party-licenses.mjs';

const extensionRoot = resolve('packages/vscode');
const outputDirectory = resolve(extensionRoot, 'dist');

await rm(resolve(outputDirectory, 'extension.cjs'), { force: true });
await rm(resolve(outputDirectory, 'server.cjs'), { force: true });
await rm(resolve(outputDirectory, 'THIRD_PARTY_LICENSES.txt'), { force: true });
await mkdir(outputDirectory, { recursive: true });

const common = {
	bundle: true,
	platform: 'node',
	format: 'cjs',
	target: 'node20',
	legalComments: 'eof',
	logLevel: 'info',
	metafile: true,
	minify: false,
	sourcemap: false,
};

const extensionBuild = await build({
	...common,
	entryPoints: [resolve(extensionRoot, 'dist/src/extension.js')],
	external: ['vscode'],
	outfile: resolve(outputDirectory, 'extension.cjs'),
});

const serverBuild = await build({
	...common,
	entryPoints: [resolve('packages/language-server/dist/src/server.js')],
	outfile: resolve(outputDirectory, 'server.cjs'),
});

const thirdPartyLicenses = await buildBundledThirdPartyLicenseText([
	extensionBuild.metafile,
	serverBuild.metafile,
]);
await writeFile(resolve(outputDirectory, 'THIRD_PARTY_LICENSES.txt'), thirdPartyLicenses);
