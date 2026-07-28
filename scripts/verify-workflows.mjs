import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const WORKFLOW_SUFFIX = /\.ya?ml$/u;
const USES_LINE = /^\s*(?:-\s*)?uses:\s*(.+?)\s*$/u;
const FULL_COMMIT_SHA = /^[0-9a-f]{40}$/u;
const PERMISSION_LINE = /^  ([a-z][a-z0-9-]*):\s*(read|write|none)\s*$/u;
const REQUIRED_TOP_LEVEL_KEYS = ['name', 'on', 'permissions', 'jobs'];

export async function verifyWorkflows(root = process.cwd()) {
	const workflowDirectory = resolve(root, '.github/workflows');
	const policyPath = resolve(root, '.github/actions-policy.json');
	const policy = JSON.parse(await readFile(policyPath, 'utf8'));
	if (policy.schemaVersion !== 3 || !validActionPolicy(policy.allowedReferences) || !validPermissionPolicy(policy.workflowPermissions)) {
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
		verifyWorkflowPermissions(file, source, policy.workflowPermissions);
		verifySecurityWorkflowPolicy(file, source);
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
			if (!FULL_COMMIT_SHA.test(reference)) {
				throw new Error(`${file}:${index + 1}: ${action}@${reference} must use a full 40-character commit SHA`);
			}
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
	for (const file of Object.keys(policy.workflowPermissions.exceptions)) {
		if (!workflowFiles.includes(file)) throw new Error(`Unused workflow permission exception: ${file}`);
	}
	console.log(`Verified ${workflowFiles.length} workflows, ${observed.size} immutable external actions, and least-privilege permissions.`);
}

function verifyWorkflowStructure(file, source) {
	if (source.includes('\t')) throw new Error(`${file}: tabs are not allowed in workflow YAML`);
	for (const key of REQUIRED_TOP_LEVEL_KEYS) {
		const expression = new RegExp(`^${key}:`, 'mu');
		if (!expression.test(source)) throw new Error(`${file}: missing top-level ${key}: key`);
	}
	if (!source.endsWith('\n')) throw new Error(`${file}: workflow must end with a newline`);
}

function verifyWorkflowPermissions(file, source, policy) {
	const lines = source.split(/\r?\n/u);
	for (const [index, line] of lines.entries()) {
		if (/^\s+permissions:/u.test(line)) {
			throw new Error(`${file}:${index + 1}: job-level permissions are not permitted; declare the workflow grant at top level`);
		}
	}
	const start = lines.findIndex(line => line === 'permissions:');
	if (start === -1) throw new Error(`${file}: missing explicit top-level permissions block`);
	const actual = {};
	for (let index = start + 1; index < lines.length; index++) {
		const line = lines[index];
		if (line.trim() === '' || line.trimStart().startsWith('#')) continue;
		if (!line.startsWith(' ')) break;
		const match = PERMISSION_LINE.exec(line);
		if (match === null) throw new Error(`${file}:${index + 1}: unsupported permissions syntax`);
		actual[match[1]] = match[2];
	}
	if (Object.keys(actual).length === 0) throw new Error(`${file}: permissions block must declare explicit scopes`);
	const expected = policy.exceptions[file] ?? policy.default;
	if (JSON.stringify(sortedRecord(actual)) !== JSON.stringify(sortedRecord(expected))) {
		throw new Error(`${file}: permissions ${JSON.stringify(sortedRecord(actual))} do not match policy ${JSON.stringify(sortedRecord(expected))}`);
	}
}

function verifySecurityWorkflowPolicy(file, source) {
	if (file !== 'dependency-review.yml') return;
	if (!source.includes('uses: actions/dependency-review-action@')) {
		throw new Error(`${file}: must run actions/dependency-review-action`);
	}
	if (/^\s+continue-on-error:\s*true\s*$/mu.test(source)) {
		throw new Error(`${file}: dependency review must remain a blocking gate`);
	}
	if (!/^\s+fail-on-severity:\s*moderate\s*$/mu.test(source)) {
		throw new Error(`${file}: dependency review must fail on moderate-or-higher findings`);
	}
}

function validActionPolicy(value) {
	if (!isRecord(value) || Object.keys(value).length === 0) return false;
	return Object.values(value).every(references => Array.isArray(references)
		&& references.length > 0
		&& references.every(reference => typeof reference === 'string' && FULL_COMMIT_SHA.test(reference)));
}

function validPermissionPolicy(value) {
	if (!isRecord(value) || !validPermissionRecord(value.default) || !isRecord(value.exceptions)) return false;
	return Object.values(value.exceptions).every(validPermissionRecord);
}

function validPermissionRecord(value) {
	return isRecord(value) && Object.keys(value).length > 0 && Object.values(value).every(item => ['read', 'write', 'none'].includes(item));
}

function sortedRecord(value) {
	return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)));
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
