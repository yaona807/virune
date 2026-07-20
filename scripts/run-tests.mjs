import { spawn } from 'node:child_process';

const integrationOnly = process.argv.includes('--integration-only');
const groups = [
	...(!integrationOnly ? [{ name: 'unit', command: ['scripts/run-unit-tests.mjs'] }] : []),
	{ name: 'CLI workflow', files: ['integration/dist/cli.test.js'] },
	{ name: 'CLI API', files: ['integration/dist/cli-api.test.js'] },
	{ name: 'conformance expectation validation', files: ['integration/dist/conformance.test.js'] },
	{ name: 'entry-point diagnostics', files: ['integration/dist/entry-point-invalid.test.js'] },
	{ name: 'entry-point runtime', files: ['integration/dist/entry-point-runtime.test.js'] },
	{ name: 'project integration', files: ['integration/dist/project.test.js'] },
	{ name: 'browser runtime', files: ['integration/dist/browser.test.js'] },
];

for (const group of groups) {
	console.log(`\n=== ${group.name} ===`);
	const code = group.command === undefined ? await runNodeTest(group.files) : await runCommand(group.command);
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

function runCommand(argumentsList) {
	const { NODE_TEST_CONTEXT: _ignored, ...env } = process.env;
	return new Promise((resolve, reject) => {
		const child = spawn(process.execPath, argumentsList, { cwd: process.cwd(), env, stdio: 'inherit' });
		child.once('error', reject);
		child.once('exit', code => resolve(code ?? 1));
	});
}
