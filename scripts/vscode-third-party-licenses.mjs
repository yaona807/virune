import { readdir, readFile, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { TextDecoder } from 'node:util';
import validateNpmPackageLicense from 'validate-npm-package-license';

const LICENSE_FILE_PATTERN = /^(?:LICEN[CS]E|COPYING)(?:[._-].*)?$/iu;
const SUPPLEMENTARY_FILE_PATTERN = /^(?:(?:NOTICE|COPYRIGHT)(?:[._-].*)?|THIRD[._-]?PARTY[._-]?(?:NOTICES?|LICEN[CS]ES?)(?:[._-].*)?)$/iu;
const utf8Decoder = new TextDecoder('utf-8', { fatal: true });

export async function buildBundledThirdPartyLicenseText(metafiles, root = process.cwd()) {
	const packageRoots = collectBundledPackageRoots(metafiles, root);
	if (packageRoots.length === 0) throw new Error('VS Code bundles did not include any third-party npm packages');
	const rootRealPath = await realpath(root);
	const packages = [];
	for (const packageRoot of packageRoots) packages.push(await readPackageLegalMaterial(packageRoot, root, rootRealPath));
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
			const absoluteInput = resolve(root, input);
			const nativeRelativeInput = relative(root, absoluteInput);
			if (escapesRoot(nativeRelativeInput)) {
				throw new Error(`VS Code bundle input escapes the repository root: ${input}`);
			}
			const relativeInput = normalizePath(nativeRelativeInput);
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

async function readPackageLegalMaterial(packageRoot, root, rootRealPath) {
	let packageRealPath;
	try {
		packageRealPath = await realpath(packageRoot);
	} catch (error) {
		throw new Error(`Cannot resolve bundled package root ${normalizePath(relative(root, packageRoot))}: ${error.message}`);
	}
	if (escapesRoot(relative(rootRealPath, packageRealPath))) {
		throw new Error(`Bundled package root escapes the repository through filesystem resolution: ${normalizePath(relative(root, packageRoot))}`);
	}

	const manifestPath = resolve(packageRoot, 'package.json');
	let manifest;
	try {
		manifest = JSON.parse(await readUtf8(manifestPath));
	} catch (error) {
		throw new Error(`Cannot read bundled package manifest ${normalizePath(relative(root, manifestPath))}: ${error.message}`);
	}
	const name = nonEmptyString(manifest.name, `${manifestPath}: name`);
	const version = nonEmptyString(manifest.version, `${manifestPath}: version`);
	const license = resolvedLicense(manifest.license, `${manifestPath}: license`);
	const entries = await readdir(packageRoot, { withFileTypes: true });
	const legalEntries = entries.filter(entry => LICENSE_FILE_PATTERN.test(entry.name) || SUPPLEMENTARY_FILE_PATTERN.test(entry.name));
	for (const entry of legalEntries) {
		if (!entry.isFile()) {
			throw new Error(`Bundled package ${name}@${version} legal entry ${entry.name} must be a regular file`);
		}
	}
	const licenseFiles = legalEntries
		.filter(entry => LICENSE_FILE_PATTERN.test(entry.name))
		.map(entry => entry.name)
		.sort(compareText);
	if (licenseFiles.length === 0) {
		throw new Error(`Bundled package ${name}@${version} does not contain a LICENSE/LICENCE/COPYING file`);
	}
	const supplementaryFiles = legalEntries
		.filter(entry => SUPPLEMENTARY_FILE_PATTERN.test(entry.name))
		.map(entry => entry.name)
		.sort(compareText);
	const fileNames = [...licenseFiles, ...supplementaryFiles.filter(name => !licenseFiles.includes(name))];
	const files = [];
	for (const fileName of fileNames) {
		let content;
		try {
			content = normalizeNewlines(await readUtf8(resolve(packageRoot, fileName)));
		} catch (error) {
			throw new Error(`Bundled package ${name}@${version} legal file ${fileName} is not valid UTF-8: ${error.message}`);
		}
		if (content.trim().length === 0) throw new Error(`Bundled package ${name}@${version} has empty legal file ${fileName}`);
		files.push({ name: fileName, content });
	}
	return { name, version, license, files };
}

async function readUtf8(path) {
	return utf8Decoder.decode(await readFile(path));
}

function resolvedLicense(value, label) {
	const license = nonEmptyString(value, label).trim();
	const validation = validateNpmPackageLicense(license);
	if (validation.validForNewPackages !== true || validation.spdx !== true) {
		throw new Error(`${label} must be a valid SPDX license expression for a new npm package; received ${JSON.stringify(license)}`);
	}
	return license;
}

function nonEmptyString(value, label) {
	if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${label} must be a non-empty string`);
	return value;
}

function escapesRoot(relativePath) {
	return relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath);
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
