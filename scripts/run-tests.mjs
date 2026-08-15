import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const integrationOnly = process.argv.includes('--integration-only');
const excludeBrowser = process.argv.includes('--exclude-browser');
const excludeSelfhostInventory = process.argv.includes('--exclude-selfhost-inventory');
const failureOutputOnly = process.argv.includes('--failure-output-only');
const platformSmoke = process.argv.includes('--platform-smoke');
const unitConcurrencyArguments = process.argv.filter(item => item.startsWith('--unit-concurrency='));
if (unitConcurrencyArguments.length > 1) {
	console.error('Specify --unit-concurrency at most once.');
	process.exit(1);
}
const unitConcurrency = unitConcurrencyArguments[0]?.slice('--unit-concurrency='.length)
	?? (process.env.VIRUNE_CI_JOB === 'core-tests-ubuntu-node24' ? '2' : undefined);
const integrationGroups = [
	{ name: 'CLI workflow', files: ['integration/dist/cli.test.js'] },
	{ name: 'CLI API', files: ['integration/dist/cli-api.test.js'] },
	{ name: 'conformance expectation validation', files: ['integration/dist/conformance.test.js'] },
	{ name: 'entry-point diagnostics', files: ['integration/dist/entry-point-invalid.test.js'] },
	{ name: 'entry-point runtime', files: ['integration/dist/entry-point-runtime.test.js'] },
	{ name: 'project integration', files: ['integration/dist/project.test.js'] },
];
const platformGroups = integrationGroups.filter(group => group.name !== 'conformance expectation validation');
const groups = platformSmoke ? platformGroups : [
	...(!integrationOnly ? [
		{
			name: 'unit',
			command: [
				'scripts/run-unit-tests.mjs',
				...(failureOutputOnly ? ['--failure-output-only'] : []),
				...(excludeSelfhostInventory ? [
					'--exclude-file=packages/compiler/dist/test/selfhost-full-language-inventory.test.js',
				] : []),
				...(unitConcurrency !== undefined ? [`--concurrency=${unitConcurrency}`] : []),
			],
		},
		{
			name: 'self-host kernel model',
			command: ['packages/cli/dist/src/main.js', 'test', 'selfhost/kernel'],
			failureOutput: '.cache/selfhost-kernel-test-failure.log',
		},
		{
			name: 'self-host compiler MVP',
			command: ['packages/cli/dist/src/main.js', 'test', 'selfhost/mvp'],
			failureOutput: '.cache/selfhost-mvp-test-failure.log',
		},
		{ name: 'documentation example policy', files: ['scripts/verify-documentation-examples.test.mjs'] },
		{
			name: 'npm publication plan policy',
			files: [
				'scripts/verify-npm-publication-plan.test.mjs',
				'scripts/verify-npm-publication-license.test.mjs',
			],
		},
		{ name: 'VS Code third-party license packaging policy', files: ['scripts/vscode-third-party-licenses.test.mjs'] },
		{
			name: 'documentation examples',
			command: ['scripts/verify-documentation-examples.mjs'],
			failureOutput: '.cache/unit-test-failure.log',
		},
	] : []),
	...integrationGroups,
	...(!excludeBrowser ? [{ name: 'browser runtime', files: ['integration/dist/browser.test.js'] }] : []),
];

for (const group of groups) {
	console.log(`\n=== ${group.name} ===`);
	const code = group.command === undefined ? await runNodeTest(group.files) : await runCommand(group.command, group.failureOutput);
	if (code !== 0) process.exit(code);
}

function runNodeTest(files) {
	const { NODE_TEST_CONTEXT: _ignored, ...env } = process.env;
	return new Promise((resolve, reject) => {
		const child = spawn(process.execPath, ['--test', '--test-timeout=120000', ...files], {
			cwd: process.cwd(),
			env,
			stdio: 'inherit',
		});
		child.once('error', reject);
		child.once('exit', code => resolve(code ?? 1));
	});
}

function runCommand(argumentsList, failureOutput) {
	const { NODE_TEST_CONTEXT: _ignored, ...env } = process.env;
	return new Promise((resolve, reject) => {
		const capture = typeof failureOutput === 'string';
		const child = spawn(process.execPath, argumentsList, {
			cwd: process.cwd(),
			env,
			stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
		});
		let output = '';
		if (capture) {
			child.stdout.setEncoding('utf8');
			child.stderr.setEncoding('utf8');
			child.stdout.on('data', chunk => { output += chunk; process.stdout.write(chunk); });
			child.stderr.on('data', chunk => { output += chunk; process.stderr.write(chunk); });
		}
		child.once('error', reject);
		child.once('exit', async code => {
			const exitCode = code ?? 1;
			if (capture && exitCode !== 0) {
				await mkdir(dirname(failureOutput), { recursive: true });
				await writeFile(failureOutput, output);
			}
			resolve(exitCode);
		});
	});
}
