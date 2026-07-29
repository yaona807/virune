#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(directory, '../..');
const manifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8')) as { version: string };
const version = manifest.version;
const releaseSourceBase = `https://github.com/yaona807/virune/blob/v${version}`;
const commandArgs = process.argv.slice(2);
const exitCode = await runMain(commandArgs);

if (exitCode === 0 && commandArgs[0] === 'init') await completeInitialization(resolve(commandArgs[1] ?? '.'));
process.exitCode = exitCode;

function runMain(args: readonly string[]): Promise<number> {
	const { NODE_TEST_CONTEXT: _nodeTestContext, ...env } = process.env;
	return new Promise((resolvePromise, reject) => {
		const child = spawn(process.execPath, [join(directory, 'main.js'), ...args], { stdio: 'inherit', env });
		child.once('error', reject);
		child.once('exit', code => resolvePromise(code ?? 1));
	});
}

async function completeInitialization(root: string): Promise<void> {
	await writeFile(join(root, 'README.md'), projectReadme(basename(root)), { flag: 'wx' }).catch(ignoreExisting);
	console.log(`\nNext steps:\n  cd ${JSON.stringify(root)}\n  npm install\n  npm run check\n  npm run start`);
	console.log(`\nGuide: ${releaseSourceBase}/README.md#quick-start`);
}

function projectReadme(name: string): string {
	return `# ${name}\n\nGenerated with Virune ${version}.\n\n## Quick start\n\n\`\`\`bash\nnpm install\nnpm run check\nnpm test\nnpm run start\n\`\`\`\n\nUse \`npm run fmt\` to format Virune source and \`npm run build\` to emit ES2022 modules.\n\n## Project structure\n\n- \`src/main.virune\` — application entry point\n- \`virune.json\` — compiler and platform configuration\n- \`package.json\` — project scripts and version-pinned Virune dependencies\n\nThis project starts with the Node.js target. The CLI, Runtime, and standard library are pinned to immutable Virune ${version} GitHub Release assets rather than npm Registry packages so the generated project uses one verified toolchain release.\n\n## Documentation\n\n- [Quick start](${releaseSourceBase}/README.md#quick-start)\n- [Language guide](${releaseSourceBase}/docs/language-guide.md)\n- [Node.js and browser standard library](${releaseSourceBase}/docs/standard-library.md)\n- [JavaScript and TypeScript interoperability](${releaseSourceBase}/docs/js-interop.md)\n`;
}

function ignoreExisting(error: unknown): void {
	if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
}
