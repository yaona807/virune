import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

export function verifyWorkspaceLicenseLock(root = process.cwd(), expectedLicense) {
	if (typeof expectedLicense !== 'string' || expectedLicense.trim().length === 0) {
		throw new Error('expectedLicense must be a non-empty string');
	}
	const lock = JSON.parse(readFileSync(resolve(root, 'package-lock.json'), 'utf8'));
	if (lock.lockfileVersion !== 3) throw new Error('package-lock.json: expected lockfileVersion 3');
	if (lock.packages === null || typeof lock.packages !== 'object' || Array.isArray(lock.packages)) {
		throw new Error('package-lock.json: packages must be an object');
	}

	const workspacePaths = listWorkspacePackageDirectories(root).map(directory => `packages/${directory}`);
	const lockWorkspacePaths = Object.keys(lock.packages)
		.filter(path => /^packages\/[^/]+$/u.test(path))
		.sort(compareText);
	if (JSON.stringify(lockWorkspacePaths) !== JSON.stringify(workspacePaths)) {
		throw new Error(`package-lock.json: workspace package entries must exactly match repository workspaces. expected=${JSON.stringify(workspacePaths)} actual=${JSON.stringify(lockWorkspacePaths)}`);
	}

	assertLicense(lock.packages[''], '', expectedLicense);
	for (const path of workspacePaths) assertLicense(lock.packages[path], path, expectedLicense);
}

function listWorkspacePackageDirectories(root) {
	return readdirSync(resolve(root, 'packages'), { withFileTypes: true })
		.filter(entry => entry.isDirectory() && existsSync(resolve(root, 'packages', entry.name, 'package.json')))
		.map(entry => entry.name)
		.sort(compareText);
}

function assertLicense(entry, path, expectedLicense) {
	const label = path === '' ? '<root>' : path;
	if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
		throw new Error(`package-lock.json: missing packages[${JSON.stringify(path)}] entry for ${label}`);
	}
	if (entry.license !== expectedLicense) {
		throw new Error(`package-lock.json: packages[${JSON.stringify(path)}].license must match reviewed root license ${expectedLicense}`);
	}
}

function compareText(left, right) {
	return left < right ? -1 : left > right ? 1 : 0;
}
