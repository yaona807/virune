import { execFileSync } from 'node:child_process';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { downloadAndUnzipVSCode, runTests } from '@vscode/test-electron';

const releaseDirectory = resolve('release');
const vsix = resolve(releaseDirectory, (await readdir(releaseDirectory)).find(file => /^virune-vscode-.*\.vsix$/u.test(file)) ?? 'missing.vsix');
const root = await mkdtemp(join(tmpdir(), 'virune-vsix-smoke-'));
const extensionsDirectory = resolve(root, 'extensions');
const userDataDirectory = resolve(root, 'user-data');
const workspace = resolve(root, 'workspace');
try {
	await writeFile(resolve(root, 'placeholder'), '', 'utf8');
	const vscodeExecutablePath = await downloadAndUnzipVSCode(process.env.VIRUNE_VSCODE_VERSION ?? 'stable');
	const cli = process.platform === 'linux'
		? resolve(dirname(vscodeExecutablePath), 'bin', 'code')
		: undefined;
	if (cli === undefined) throw new Error('VSIX release smoke currently requires Linux.');
	const common = ['--extensions-dir', extensionsDirectory, '--user-data-dir', userDataDirectory];
	execFileSync(cli, ['--install-extension', vsix, '--force', ...common], { stdio: 'inherit' });
	const installed = execFileSync(cli, ['--list-extensions', '--show-versions', ...common], { encoding: 'utf8' });
	if (!/^virune\.virune-vscode@1\.0\.0$/mu.test(installed)) throw new Error(`Installed extension was not listed:\n${installed}`);
	await writeFile(resolve(workspace, 'virune.json'), `${JSON.stringify({ languageVersion: '1.0', platform: 'node', sourceDir: 'src', outDir: 'dist', entry: 'src/main.virune', target: 'es2022' }, null, 2)}\n`, { encoding: 'utf8', flag: 'w' }).catch(async error => {
		if (error?.code !== 'ENOENT') throw error;
		const { mkdir } = await import('node:fs/promises');
		await mkdir(workspace, { recursive: true });
		await writeFile(resolve(workspace, 'virune.json'), `${JSON.stringify({ languageVersion: '1.0', platform: 'node', sourceDir: 'src', outDir: 'dist', entry: 'src/main.virune', target: 'es2022' }, null, 2)}\n`);
	});
	await runTests({
		vscodeExecutablePath,
		extensionDevelopmentPath: resolve('scripts/vsix-smoke-harness'),
		extensionTestsPath: resolve('scripts/vsix-smoke-suite.mjs'),
		launchArgs: [workspace, '--extensions-dir', extensionsDirectory, '--user-data-dir', userDataDirectory, '--disable-updates', '--skip-welcome', '--skip-release-notes'],
		extensionTestsEnv: { ...process.env, VIRUNE_VSIX_EXTENSIONS_DIR: extensionsDirectory, VIRUNE_VSIX_WORKSPACE: workspace },
	});
	execFileSync(cli, ['--uninstall-extension', 'virune.virune-vscode', ...common], { stdio: 'inherit' });
	const after = execFileSync(cli, ['--list-extensions', ...common], { encoding: 'utf8' });
	if (/^virune\.virune-vscode$/mu.test(after)) throw new Error('Virune extension remained installed after uninstall.');
	console.log('VSIX clean-install, activation, Language Server and uninstall smoke passed.');
} finally {
	await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
}
