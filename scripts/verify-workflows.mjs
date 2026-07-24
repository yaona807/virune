import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const WORKFLOW_SUFFIX = /\.ya?ml$/u;
const USES_LINE = /^\s*(?:-\s*)?uses:\s*(.+?)\s*$/u;
const REQUIRED_TOP_LEVEL_KEYS = ['name', 'on', 'jobs'];

export async function verifyWorkflows(root = process.cwd()) {
	const workflowDirectory = resolve(root, '.github/workflows');
	const policyPath = resolve(root, '.github/actions-policy.json');
	const policy = JSON.parse(await readFile(policyPath, 'utf8'));
	if (policy.schemaVersion !== 1 || !isRecord(policy.allowedReferences)) {
		throw new Error('Invalid .github/actions-policy.json');
	}

	const workflowFiles = (await readdir(workflowDirectory))
		.filter(file => WORKFLOW_SUFFIX.test(file))
		.sort();
	if (workflowFiles.length === 0) throw new Error('No GitHub Actions workflows found.');

	const observed = new Set();
	for (const file of workflowFiles) {
		const source = await readFile(resolve(workflowDirectory, file), 'utf8');
		verifyWorkflowStructure(file, source);
		for (const [index, line] of source.split(/\r?\n/u).entries()) {
			const trimmed = line.trim();
			if (trimmed.length === 0 || trimmed.startsWith('#') || !trimmed.includes('uses:')) continue;
			const match = USES_LINE.exec(line);
			if (match === null) throw new Error(`${file}:${index + 1}: unsupported uses syntax`);
			const target = unquote(match[1].replace(/\s+#.*$/u, '').trim());
			if (target.startsWith('./') || target.startsWith('docker://')) continue;
			const separator = target.lastIndexOf('@');
			if (separator <= 0 || separator === target.length - 1) {
				throw new Error(`${file}:${index + 1}: action reference must include an explicit ref: ${target}`);
			}
			const action = target.slice(0, separator);
			const reference = target.slice(separator + 1);
			const allowed = policy.allowedReferences[action];
			if (!Array.isArray(allowed) || !allowed.includes(reference)) {
				throw new Error(`${file}:${index + 1}: ${action}@${reference} is not permitted by .github/actions-policy.json`);
			}
			observed.add(action);
		}
	}

	for (const action of Object.keys(policy.allowedReferences)) {
		if (!observed.has(action)) throw new Error(`Unused action policy entry: ${action}`);
	}
	console.log(`Verified ${workflowFiles.length} workflows and ${observed.size} external actions.`);
}

function verifyWorkflowStructure(file, source) {
	if (source.includes('\t')) throw new Error(`${file}: tabs are not allowed in workflow YAML`);
	for (const key of REQUIRED_TOP_LEVEL_KEYS) {
		const expression = new RegExp(`^${key}:`, 'mu');
		if (!expression.test(source)) throw new Error(`${file}: missing top-level ${key}: key`);
	}
	if (!source.endsWith('\n')) throw new Error(`${file}: workflow must end with a newline`);
}

function unquote(value) {
	if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
		return value.slice(1, -1);
	}
	return value;
}

function isRecord(value) {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const entry = process.argv[1] === undefined ? undefined : resolve(process.argv[1]);
if (entry === fileURLToPath(import.meta.url)) {
	await verifyWorkflows(resolve(process.argv[2] ?? '.'));
}
