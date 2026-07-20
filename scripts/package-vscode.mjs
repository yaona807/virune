import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { writeReleaseIntegrityFiles } from './release-manifest.mjs';
import { createVSIX, listFiles } from '@vscode/vsce';

const extensionDirectory = resolve('packages/vscode');
const extensionPackage = JSON.parse(readFileSync(resolve(extensionDirectory, 'package.json'), 'utf8'));
const outputDirectory = resolve('release');
const outputFile = resolve(outputDirectory, `virune-vscode-${extensionPackage.version}.vsix`);
mkdirSync(outputDirectory, { recursive: true });

const includedFiles = await listFiles({
	cwd: extensionDirectory,
	packagedDependencies: [],
});
const requiredFiles = [
	'package.json',
	'language-configuration.json',
	'syntaxes/virune.tmLanguage.json',
	'dist/extension.cjs',
	'dist/server.cjs',
];
for (const required of requiredFiles) {
	if (!includedFiles.includes(required)) throw new Error(`VSIX input is missing ${required}`);
}
const forbidden = includedFiles.find(file => file.startsWith('src/') || file.startsWith('test/') || file === 'tsconfig.json');
if (forbidden !== undefined) throw new Error(`VSIX input contains development-only file: ${forbidden}`);

await createVSIX({
	cwd: extensionDirectory,
	packagePath: outputFile,
	dependencies: false,
	allowMissingRepository: true,
});

if (!statSync(outputFile).isFile()) throw new Error(`VSIX was not created: ${outputFile}`);
const bytes = readFileSync(outputFile);
writeFileSync(resolve(outputDirectory, 'VSCODE-MANIFEST.json'), `${JSON.stringify({
	schemaVersion: 1,
	version: extensionPackage.version,
	file: basename(outputFile),
	sha256: createHash('sha256').update(bytes).digest('hex'),
	bytes: bytes.byteLength,
}, null, 2)}\n`);
writeReleaseIntegrityFiles(outputDirectory, extensionPackage.version);
