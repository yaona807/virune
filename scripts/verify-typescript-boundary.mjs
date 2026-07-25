import { readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const policyPath = resolve(repositoryRoot, '.github/typescript-version-policy.json');
const excludedDirectories = new Set(['.git', '.cache', '.vscode-test', 'coverage', 'dist', 'node_modules', 'release']);
const importPattern = /(?:\bfrom\s*|\bimport\s*\(|\brequire\s*\()\s*['"]typescript['"]/g;

export async function verifyTypeScriptBoundary({ root = repositoryRoot, policyFile = policyPath, reportPath } = {}) {
	const policy = JSON.parse(await readFile(policyFile, 'utf8'));
	const imports = [];
	const manifests = [];
	await scanDirectory(root, root, imports, manifests);

	const allowedRoots = policy.compilerApiBoundary.allowedSourceRoots;
	const allowedManifests = new Set(policy.compilerApiBoundary.allowedPackageManifests);
	const violations = [];
	for (const item of imports) {
		if (!allowedRoots.some(prefix => item.path.startsWith(prefix))) {
			violations.push({ kind: 'compiler-api-import-outside-boundary', ...item });
		}
	}
	for (const item of manifests) {
		if (!allowedManifests.has(item.path)) {
			violations.push({ kind: 'typescript-dependency-outside-boundary', ...item });
		}
	}

	const rootManifest = manifests.find(item => item.path === 'package.json');
	const interopManifest = manifests.find(item => item.path === 'packages/js-interop/package.json');
	if (rootManifest?.dependencies.typescript !== policy.current.buildCompiler) {
		violations.push({
			kind: 'current-build-compiler-version',
			path: 'package.json',
			expected: policy.current.buildCompiler,
			actual: rootManifest?.dependencies.typescript ?? null,
		});
	}
	if (interopManifest?.dependencies.typescript !== policy.current.compilerApi) {
		violations.push({
			kind: 'current-compiler-api-version',
			path: 'packages/js-interop/package.json',
			expected: policy.current.compilerApi,
			actual: interopManifest?.dependencies.typescript ?? null,
		});
	}

	const report = {
		schemaVersion: 1,
		generatedAt: new Date().toISOString(),
		policy: relative(root, policyFile).split(sep).join('/'),
		imports,
		manifests,
		violations,
		passed: violations.length === 0,
	};
	if (reportPath !== undefined) {
		await writeFile(resolve(root, reportPath), `${JSON.stringify(report, null, '\t')}\n`, 'utf8');
	}
	if (!report.passed) {
		throw new Error(`TypeScript boundary verification failed:\n${violations.map(item => `- ${item.kind}: ${item.path}`).join('\n')}`);
	}
	console.log(`Verified TypeScript Compiler API boundary: ${imports.length} imports across ${new Set(imports.map(item => item.path)).size} files.`);
	return report;
}

async function scanDirectory(root, directory, imports, manifests) {
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		if (entry.isDirectory() && excludedDirectories.has(entry.name)) continue;
		const absolute = resolve(directory, entry.name);
		const path = relative(root, absolute).split(sep).join('/');
		if (entry.isDirectory()) {
			await scanDirectory(root, absolute, imports, manifests);
			continue;
		}
		if (!entry.isFile()) continue;
		if (entry.name === 'package.json') {
			const manifest = JSON.parse(await readFile(absolute, 'utf8'));
			const dependencies = {};
			for (const section of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
				for (const [name, version] of Object.entries(manifest[section] ?? {})) {
					if (name === 'typescript' || name === '@typescript/native' || name === '@typescript/typescript6') {
						dependencies[name] = version;
					}
				}
			}
			if (Object.keys(dependencies).length > 0) manifests.push({ path, dependencies });
		}
		if (!/\.[cm]?[jt]sx?$/.test(entry.name)) continue;
		const text = await readFile(absolute, 'utf8');
		for (const match of text.matchAll(importPattern)) {
			const offset = match.index ?? 0;
			const line = text.slice(0, offset).split('\n').length;
			imports.push({ path, line });
		}
	}
}

const entry = process.argv[1] === undefined ? undefined : resolve(process.argv[1]);
if (entry === fileURLToPath(import.meta.url)) {
	await verifyTypeScriptBoundary({ reportPath: process.env.VIRUNE_TYPESCRIPT_BOUNDARY_REPORT });
}
