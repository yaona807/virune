import { readdir, readFile } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';

const LICENSE_FILE_PATTERN = /^(?:LICEN[CS]E|COPYING)(?:[._-].*)?$/iu;
const SUPPLEMENTARY_FILE_PATTERN = /^(?:NOTICE|COPYRIGHT)(?:[._-].*)?$/iu;

export async function buildBundledThirdPartyLicenseText(metafiles, root = process.cwd()) {
	const packageRoots = collectBundledPackageRoots(metafiles, root);
	const packages = [];
	for (const packageRoot of packageRoots) packages.push(await readPackageLegalMaterial(packageRoot, root));
	packages.sort(comparePackageMaterial);

	const deduplicated = [];
	for (const item of packages) {
		const previous = deduplicated.at(-1);
		if (previous?.name === item.name && previous.version === item.version) {
			if (JSON.stringify(previous.files) !== JSON.stringify(item.files) || previous.license !== item.license) {
				throw new Error(`Bundled package ${item.name}@${item.version} has inconsistent legal metadata across installations`);
			}
			continue;
		}
		deduplicated.push(item);
	}

	const lines = [
		'Virune VS Code Extension — Bundled Third-Party License Texts',
		'',
		'This file is generated from the npm packages whose code is included in the VS Code extension bundles.',
		'It is generated deterministically from esbuild metadata and the installed package legal files.',
		'',
	];
	for (const item of deduplicated) {
		lines.push('===============================================================================');
		lines.push(`PACKAGE: ${item.name}@${item.version}`);
		lines.push(`DECLARED LICENSE: ${item.license}`);
		for (const file of item.files) {
			lines.push('-------------------------------------------------------------------------------');
			lines.push(`FILE: ${file.name}`);
			lines.push('');
			lines.push(file.content.replace(/\n$/u, ''));
		}
		lines.push('');
	}
	return `${lines.join('\n').replace(/\n+$/u, '')}\n`;
}

export function collectBundledPackageRoots(metafiles, root = process.cwd()) {
	const roots = new Set();
	for (const metafile of metafiles) {
		if (metafile === null || typeof metafile !== 'object' || Array.isArray(metafile)) {
			throw new Error('Expected an esbuild metafile object');
		}
		const inputs = metafile.inputs;
		if (inputs === null || typeof inputs !== 'object' || Array.isArray(inputs)) {
			throw new Error('Expected esbuild metafile inputs');
		}
		for (const input of Object.keys(inputs)) {
			const relativeInput = normalizePath(relative(root, resolve(root, input)));
			const marker = 'node_modules/';
			const markerIndex = relativeInput.lastIndexOf(marker);
			if (markerIndex < 0) continue;
			const remainder = relativeInput.slice(markerIndex + marker.length);
			const segments = remainder.split('/');
			const packageSegmentCount = segments[0]?.startsWith('@') ? 2 : 1;
			if (segments.length < packageSegmentCount || segments.slice(0, packageSegmentCount).some(segment => segment.length === 0)) {
				throw new Error(`Cannot determine bundled package root from ${input}`);
			}
			const packageRelativeRoot = `${relativeInput.slice(0, markerIndex + marker.length)}${segments.slice(0, packageSegmentCount).join('/')}`;
			const packageRoot = resolve(root, ...packageRelativeRoot.split('/'));
			roots.add(packageRoot);
		}
	}
	return [...roots].sort(compareText);
}

async function readPackageLegalMaterial(packageRoot, root) {
	const manifestPath = resolve(packageRoot, 'package.json');
	let manifest;
	try {
		manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
	} catch (error) {
		throw new Error(`Cannot read bundled package manifest ${normalizePath(relative(root, manifestPath))}: ${error.message}`);
	}
	const name = nonEmptyString(manifest.name, `${manifestPath}: name`);
	const version = nonEmptyString(manifest.version, `${manifestPath}: version`);
	const license = nonEmptyString(manifest.license, `${manifestPath}: license`);
	const entries = await readdir(packageRoot, { withFileTypes: true });
	const licenseFiles = entries
		.filter(entry => entry.isFile() && LICENSE_FILE_PATTERN.test(entry.name))
		.map(entry => entry.name)
		.sort(compareText);
	if (licenseFiles.length === 0) {
		throw new Error(`Bundled package ${name}@${version} does not contain a LICENSE/LICENCE/COPYING file`);
	}
	const supplementaryFiles = entries
		.filter(entry => entry.isFile() && SUPPLEMENTARY_FILE_PATTERN.test(entry.name))
		.map(entry => entry.name)
		.sort(compareText);
	const fileNames = [...licenseFiles, ...supplementaryFiles.filter(name => !licenseFiles.includes(name))];
	const files = [];
	for (const fileName of fileNames) {
		const content = normalizeNewlines(await readFile(resolve(packageRoot, fileName), 'utf8'));
		if (content.trim().length === 0) throw new Error(`Bundled package ${name}@${version} has empty legal file ${fileName}`);
		files.push({ name: fileName, content });
	}
	return { name, version, license, files };
}

function nonEmptyString(value, label) {
	if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${label} must be a non-empty string`);
	return value;
}

function normalizeNewlines(value) {
	return value.replace(/\r\n?/gu, '\n');
}

function normalizePath(value) {
	return sep === '/' ? value : value.split(sep).join('/');
}

function comparePackageMaterial(left, right) {
	return compareText(left.name, right.name) || compareText(left.version, right.version) || compareText(JSON.stringify(left.files), JSON.stringify(right.files));
}

function compareText(left, right) {
	return left < right ? -1 : left > right ? 1 : 0;
}
