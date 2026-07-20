import { mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build } from 'esbuild';

const extensionRoot = resolve('packages/vscode');
const outputDirectory = resolve(extensionRoot, 'dist');

await rm(resolve(outputDirectory, 'extension.cjs'), { force: true });
await rm(resolve(outputDirectory, 'server.cjs'), { force: true });
await mkdir(outputDirectory, { recursive: true });

const common = {
	bundle: true,
	platform: 'node',
	format: 'cjs',
	target: 'node20',
	legalComments: 'eof',
	logLevel: 'info',
	minify: false,
	sourcemap: false,
};

await build({
	...common,
	entryPoints: [resolve(extensionRoot, 'dist/src/extension.js')],
	external: ['vscode'],
	outfile: resolve(outputDirectory, 'extension.cjs'),
});

await build({
	...common,
	entryPoints: [resolve('packages/language-server/dist/src/server.js')],
	outfile: resolve(outputDirectory, 'server.cjs'),
});
