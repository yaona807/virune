import { createHash } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import { builtinModules } from 'node:module';
import { dirname, relative, resolve, sep } from 'node:path';
import { build } from 'esbuild';

const sha256 = value => createHash('sha256').update(value).digest('hex');
const builtins = new Set([...builtinModules, ...builtinModules.map(name => `node:${name}`)]);
const closureGapWarningIds = new Set([
	'ignored-bare-import',
	'unsupported-dynamic-import',
	'unsupported-require-call',
]);
const closureGapLogOverride = Object.freeze(Object.fromEntries(
	[...closureGapWarningIds].map(id => [id, 'error']),
));
const directHostLogOverride = Object.freeze({
	...closureGapLogOverride,
	'unsupported-dynamic-import': 'warning',
});
const separatelyBoundImports = new Map([
	['selfhost/bootstrap-artifact-normalizer.js', 'bootstrap-policy'],
]);
const projectBuildEntry = 'project/project.js';
const lazyLegacyImports = new Set([
	'selfhost/compiler-facade.js\u0000./legacy-adapter.js\u0000dynamic-import',
	'selfhost/mvp-adapter.js\u0000./legacy-adapter.js\u0000dynamic-import',
]);
const generatedDynamicLoadingBoundaries = new Map([
	['selfhost/bootstrap-execution-probe.js', Object.freeze({
		warningId: 'unsupported-dynamic-import',
		expectedCount: 1,
		binding: 'generated:bootstrap-execution-candidate-v1',
		expectedNormalizedSourceSha256: '615682781559b266c6b296b0d7ff6152060f91211e7d2a17e5aecac3253528de',
		warningLine: 'return validateSelfhostMvpModule(await import(moduleUrl.href));',
		sourceContract: [
			'export async function loadBootstrapCompilerCandidate(root, entryModulePath) {',
			"const canonicalEntryPath = normalizeKernelPath(entryModulePath, '$.entryModulePath');",
			"if (!canonicalEntryPath.endsWith('.js')) throw new Error('Bootstrap compiler entry module must be JavaScript');",
			'const moduleUrl = new URL(pathToFileURL(join(root, canonicalEntryPath)).href);',
			"moduleUrl.searchParams.set('probe', `${Date.now()}-${Math.random()}`);",
			'return validateSelfhostMvpModule(await import(moduleUrl.href));',
			'}',
		].join(' '),
	})],
	['selfhost/bootstrap-stage-loader.js', Object.freeze({
		warningId: 'unsupported-dynamic-import',
		expectedCount: 1,
		binding: 'generated:bootstrap-stage-compiler-candidate-v1',
		expectedNormalizedSourceSha256: '7880ee7b5813161036fbf405f0e9795869b5cc72e3cc2ae2a7e6db0806012e65',
		warningLine: 'const loaded = await import(moduleUrl.href);',
		sourceContract: [
			'const entryModulePath = entryCandidates[0];',
			'const moduleUrl = new URL(pathToFileURL(join(root, entryModulePath)).href);',
			"moduleUrl.searchParams.set('stage', `${artifact.sha256}-${Date.now()}-${Math.random()}`);",
			'const loaded = await import(moduleUrl.href);',
		].join(' '),
	})],
]);

export async function hashRequiredSelfhostHostContract({
	repositoryRoot,
	compilerDist,
	files,
	claim = 'required-selfhost-host-execution-contract-v3',
}) {
	const root = resolve(repositoryRoot);
	const base = resolve(compilerDist);
	assertInside(root, base, 'compilerDist');
	if (!Array.isArray(files) || files.length === 0) throw new Error('Host contract files must contain at least one module');
	const canonicalFiles = files.map((value, index) => canonicalRelativePath(value, `files[${index}]`));
	if (new Set(canonicalFiles).size !== canonicalFiles.length) throw new Error('Host contract files must not contain duplicates');
	canonicalFiles.sort(compareText);
	const fixedSet = new Set(canonicalFiles);
	const entries = [];
	const imports = [];
	const dynamicLoading = [];
	let projectClosure = null;

	for (const relativePath of canonicalFiles) {
		const absolutePath = await resolveNonSymlinkInside(base, relativePath, `Host module ${relativePath}`);
		const bytes = await readFile(absolutePath);
		entries.push({ path: relativePath, sha256: sha256(bytes), bytes: bytes.byteLength });
		if (!relativePath.endsWith('.js') && !relativePath.endsWith('.mjs')) continue;
		const analysis = await directModuleImports(bytes.toString('utf8'), relativePath);
		if (analysis.dynamicLoading !== null) {
			dynamicLoading.push({ importer: relativePath, ...analysis.dynamicLoading });
		}
		for (const item of analysis.imports) {
			if (isBuiltin(item.specifier)) {
				imports.push({ importer: relativePath, specifier: item.specifier, kind: item.kind, binding: 'node-builtin' });
				continue;
			}
			if (!item.specifier.startsWith('.')) {
				throw new Error(`Host module ${relativePath} has unbound external runtime import ${item.specifier}`);
			}
			const imported = await resolveRelativeModuleSpecifier(base, absolutePath, item.specifier);
			if (fixedSet.has(imported)) {
				imports.push({ importer: relativePath, specifier: item.specifier, kind: item.kind, binding: `fixed:${imported}` });
				continue;
			}
			const separatelyBound = separatelyBoundImports.get(imported);
			if (separatelyBound !== undefined) {
				imports.push({ importer: relativePath, specifier: item.specifier, kind: item.kind, binding: `component:${separatelyBound}` });
				continue;
			}
			if (imported === projectBuildEntry) {
				projectClosure ??= await hashBundledRuntimeClosure({
					repositoryRoot: root,
					entryPoint: portableRelative(root, resolve(base, imported)),
					claim: 'required-selfhost-host-project-build-v1',
				});
				imports.push({ importer: relativePath, specifier: item.specifier, kind: item.kind, binding: 'closure:project-build' });
				continue;
			}
			if (imported === 'selfhost/legacy-adapter.js') {
				const key = `${relativePath}\u0000${item.specifier}\u0000${item.kind}`;
				if (!lazyLegacyImports.has(key)) {
					throw new Error(`Host module ${relativePath} may exclude Legacy only through the versioned lazy import boundary`);
				}
				imports.push({ importer: relativePath, specifier: item.specifier, kind: item.kind, binding: 'excluded:lazy-legacy' });
				continue;
			}
			throw new Error(`Host module ${relativePath} has unbound relative runtime import ${item.specifier} -> ${imported}`);
		}
	}

	imports.sort(compareImport);
	dynamicLoading.sort(compareDynamicLoading);
	const manifest = {
		version: 3,
		claim: canonicalText(claim, 'claim'),
		files: entries,
		imports,
		dynamicLoading,
		projectBuildClosure: projectClosure === null
			? null
			: { claim: projectClosure.manifest.claim, sha256: projectClosure.sha256 },
	};
	const serialized = JSON.stringify(manifest);
	return { manifest, serialized, sha256: sha256(serialized), projectBuildClosure: projectClosure };
}

export async function validateGeneratedDynamicLoadingBoundary(source, fileName) {
	if (!generatedDynamicLoadingBoundaries.has(fileName)) {
		throw new Error(`Host module ${fileName} is not a versioned generated dynamic-loading boundary`);
	}
	const analysis = await directModuleImports(source, fileName);
	if (analysis.dynamicLoading === null) {
		throw new Error(`Host module ${fileName} did not produce its required generated dynamic-loading boundary`);
	}
	return analysis.dynamicLoading;
}

export async function hashBundledRuntimeClosure({ repositoryRoot, entryPoint, claim }) {
	const root = resolve(repositoryRoot);
	const canonicalEntry = canonicalRelativePath(entryPoint, 'entryPoint');
	await resolveNonSymlinkInside(root, canonicalEntry, 'runtime closure entryPoint');
	let result;
	try {
		result = await build({
			absWorkingDir: root,
			entryPoints: [canonicalEntry],
			bundle: true,
			platform: 'node',
			format: 'esm',
			packages: 'bundle',
			mainFields: ['main'],
			conditions: [],
			ignoreAnnotations: true,
			treeShaking: false,
			preserveSymlinks: true,
			metafile: true,
			write: false,
			logLevel: 'silent',
			logOverride: closureGapLogOverride,
			legalComments: 'none',
		});
	} catch (error) {
		throwClosureGapFailure(error, `Host runtime closure ${canonicalEntry}`);
		throw new Error(`Host runtime closure ${canonicalEntry} could not be resolved: ${error instanceof Error ? error.message : String(error)}`);
	}
	if (result.metafile === undefined) throw new Error(`Host runtime closure ${canonicalEntry} did not produce dependency metadata`);
	assertNoClosureGapWarnings(result.warnings, `Host runtime closure ${canonicalEntry}`);
	validateBundledRuntimeOutputs(result, canonicalEntry);
	const inputPaths = Object.keys(result.metafile.inputs).sort(compareText);
	if (inputPaths.length === 0) throw new Error(`Host runtime closure ${canonicalEntry} is empty`);
	const canonicalInputPaths = inputPaths.map(path => canonicalMetafilePath(path));
	if (new Set(canonicalInputPaths).size !== canonicalInputPaths.length) throw new Error(`Host runtime closure ${canonicalEntry} contains duplicate canonical input paths`);
	const inputSet = new Set(canonicalInputPaths);
	const inputs = [];
	for (const [index, rawPath] of inputPaths.entries()) {
		const path = canonicalInputPaths[index];
		const absolutePath = await resolveNonSymlinkInside(root, path, `runtime closure input ${path}`);
		const bytes = await readFile(absolutePath);
		const metadata = result.metafile.inputs[rawPath];
		if (metadata.format === 'cjs') {
			throw new Error(`Host runtime closure ${path} is CommonJS; require closure must be modeled explicitly before it can be promotion-counting`);
		}
		const imports = [];
		for (const item of metadata.imports ?? []) {
			const importPath = canonicalMetafileImportPath(item.path);
			if (item.external) {
				if (!isBuiltin(importPath)) throw new Error(`Host runtime closure ${path} left unbound external import ${importPath}`);
			} else if (!inputSet.has(importPath)) {
				throw new Error(`Host runtime closure ${path} references unresolved input ${importPath}`);
			}
			imports.push({ path: importPath, kind: canonicalText(item.kind, `${path}.import.kind`), external: item.external === true });
		}
		imports.sort(compareClosureImport);
		inputs.push({
			path,
			sha256: sha256(bytes),
			bytes: bytes.byteLength,
			format: metadata.format ?? null,
			imports,
		});
	}
	if (!inputSet.has(canonicalEntry)) throw new Error(`Host runtime closure does not contain its entry point ${canonicalEntry}`);
	inputs.sort((left, right) => compareText(left.path, right.path));
	const manifest = { version: 1, claim: canonicalText(claim, 'claim'), entryPoint: canonicalEntry, inputs };
	const serialized = JSON.stringify(manifest);
	return { manifest, serialized, sha256: sha256(serialized) };
}

function validateBundledRuntimeOutputs(result, canonicalEntry) {
	for (const [outputPath, metadata] of Object.entries(result.metafile.outputs)) {
		for (const item of metadata.imports ?? []) {
			if (!item.external) continue;
			const importPath = canonicalText(item.path, `${outputPath}.import.path`);
			if (!isBuiltin(importPath)) throw new Error(`Host runtime closure ${canonicalEntry} leaves unbound output import ${importPath}`);
		}
	}
}

function throwClosureGapFailure(error, label) {
	const errors = error !== null && typeof error === 'object' && Array.isArray(error.errors)
		? error.errors
		: [];
	const gapErrors = [...new Set(errors
		.map(item => item?.id)
		.filter(id => closureGapWarningIds.has(id)))]
		.sort(compareText);
	if (gapErrors.length > 0) {
		throw new Error(`${label} contains non-analyzable module loading: ${gapErrors.join(', ')}`);
	}
}

function assertNoClosureGapWarnings(warnings, label) {
	const gapWarnings = (warnings ?? [])
		.filter(warning => closureGapWarningIds.has(warning.id))
		.map(warning => warning.id)
		.sort(compareText);
	if (gapWarnings.length > 0) {
		throw new Error(`${label} contains non-analyzable module loading: ${gapWarnings.join(', ')}`);
	}
}

async function directModuleImports(source, fileName) {
	const imports = new Map();
	let result;
	try {
		result = await build({
			stdin: { contents: source, sourcefile: fileName, loader: 'js' },
			bundle: true,
			platform: 'node',
			format: 'esm',
			write: false,
			logLevel: 'silent',
			logOverride: directHostLogOverride,
			plugins: [{
				name: 'collect-host-boundary-imports',
				setup(context) {
					context.onResolve({ filter: /.*/ }, args => {
						const key = `${args.path}\u0000${args.kind}`;
						imports.set(key, { specifier: args.path, kind: args.kind });
						return { path: args.path, external: true };
					});
				},
			}],
		});
	} catch (error) {
		throwClosureGapFailure(error, `Host module ${fileName}`);
		throw new Error(`Host module ${fileName} is not valid JavaScript: ${error instanceof Error ? error.message : String(error)}`);
	}
	const warnings = result.warnings ?? [];
	const forbiddenWarnings = warnings.filter(warning => closureGapWarningIds.has(warning.id) && warning.id !== 'unsupported-dynamic-import');
	if (forbiddenWarnings.length > 0) {
		const ids = [...new Set(forbiddenWarnings.map(warning => warning.id))].sort(compareText);
		throw new Error(`Host module ${fileName} contains non-analyzable module loading: ${ids.join(', ')}`);
	}
	const dynamicWarnings = warnings.filter(warning => warning.id === 'unsupported-dynamic-import');
	const boundary = generatedDynamicLoadingBoundaries.get(fileName);
	if (boundary === undefined) {
		if (dynamicWarnings.length > 0) {
			throw new Error(`Host module ${fileName} contains non-analyzable module loading: unsupported-dynamic-import`);
		}
		return {
			imports: [...imports.values()].sort((left, right) => compareText(left.specifier, right.specifier) || compareText(left.kind, right.kind)),
			dynamicLoading: null,
		};
	}
	if (dynamicWarnings.length !== boundary.expectedCount) {
		throw new Error(`Host module ${fileName} must contain exactly ${boundary.expectedCount} ${boundary.binding} dynamic load; received ${dynamicWarnings.length}`);
	}
	const normalizedSource = normalizeSourceContract(source);
	if (sha256(normalizedSource) !== boundary.expectedNormalizedSourceSha256) {
		throw new Error(`Host module ${fileName} does not match reviewed ${boundary.binding} module provenance`);
	}
	const sourceContractCount = countOccurrences(normalizedSource, boundary.sourceContract);
	if (sourceContractCount !== 1) {
		throw new Error(`Host module ${fileName} must match exactly one ${boundary.binding} source contract; received ${sourceContractCount}`);
	}
	const warningLineCount = countOccurrences(normalizedSource, boundary.warningLine);
	if (warningLineCount !== boundary.expectedCount) {
		throw new Error(`Host module ${fileName} must contain exactly ${boundary.expectedCount} ${boundary.binding} target line; received ${warningLineCount}`);
	}
	for (const warning of dynamicWarnings) {
		const warningLine = normalizeSourceContract(warning?.location?.lineText ?? '');
		if (warning.id !== boundary.warningId || warningLine !== boundary.warningLine) {
			throw new Error(`Host module ${fileName} dynamic load does not match ${boundary.binding} target contract`);
		}
	}
	return {
		imports: [...imports.values()].sort((left, right) => compareText(left.specifier, right.specifier) || compareText(left.kind, right.kind)),
		dynamicLoading: {
			warningId: boundary.warningId,
			count: boundary.expectedCount,
			binding: boundary.binding,
		},
	};
}

async function resolveRelativeModuleSpecifier(base, importer, specifier) {
	const imported = resolve(dirname(importer), specifier);
	const candidates = /\.(?:m?js|json)$/u.test(specifier)
		? [imported]
		: [`${imported}.js`, `${imported}.mjs`, `${imported}.json`, resolve(imported, 'index.js')];
	for (const candidate of candidates) {
		try {
			const path = portableRelative(base, candidate);
			await resolveNonSymlinkInside(base, path, `relative import ${specifier}`);
			return path;
		} catch (error) {
			if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
		}
	}
	throw new Error(`Host relative runtime import cannot be resolved: ${specifier} from ${portableRelative(base, importer)}`);
}

async function resolveNonSymlinkInside(root, value, label) {
	const absolute = resolve(root, value);
	assertInside(root, absolute, label);
	const rootStats = await lstat(root);
	if (rootStats.isSymbolicLink()) throw new Error(`${label} traverses a symlink path component: ${root}`);
	const relation = relative(root, absolute);
	let current = root;
	let finalStats = rootStats;
	if (relation !== '') {
		for (const component of relation.split(sep).filter(Boolean)) {
			current = resolve(current, component);
			finalStats = await lstat(current);
			if (finalStats.isSymbolicLink()) throw new Error(`${label} traverses a symlink path component: ${current}`);
		}
	}
	if (!finalStats.isFile()) throw new Error(`${label} must resolve to a regular non-symlink file`);
	return absolute;
}

function assertInside(root, absolute, label) {
	const relation = relative(root, absolute);
	if (relation === '..' || relation.startsWith(`..${sep}`) || relation.startsWith('/') || relation.startsWith('\\')) {
		throw new Error(`${label} must stay inside ${root}`);
	}
}

function portableRelative(root, absolute) {
	assertInside(root, absolute, 'runtime closure path');
	const relation = relative(root, absolute);
	if (relation === '') throw new Error(`runtime closure path must identify a file below ${root}`);
	return relation.replaceAll('\\', '/');
}

function canonicalRelativePath(value, label) {
	const text = canonicalText(value, label).replaceAll('\\', '/');
	if (text.startsWith('/') || text.startsWith('../') || text.includes('/../') || text === '..' || text.startsWith('./')) {
		throw new Error(`${label} must be a canonical repository-relative path`);
	}
	return text;
}

function canonicalMetafilePath(value) {
	const path = canonicalText(value, 'metafile input path').replaceAll('\\', '/');
	if (path.startsWith('<') || path.startsWith('/') || path.startsWith('../') || path.includes('/../')) {
		throw new Error(`Host runtime closure contains non-canonical input path ${path}`);
	}
	return path;
}

function canonicalMetafileImportPath(value) {
	const path = canonicalText(value, 'metafile import path').replaceAll('\\', '/');
	if (isBuiltin(path)) return path;
	if (path.startsWith('<') || path.startsWith('/') || path.startsWith('../') || path.includes('/../')) {
		throw new Error(`Host runtime closure contains non-canonical import path ${path}`);
	}
	return path;
}

function isBuiltin(value) {
	return builtins.has(value) || (value.startsWith('node:') && builtins.has(value.slice('node:'.length)));
}

function canonicalText(value, label) {
	if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) throw new Error(`${label} must be a non-empty canonical string`);
	return value;
}

function normalizeSourceContract(value) {
	return String(value).replace(/\s+/gu, ' ').trim();
}

function countOccurrences(value, needle) {
	if (needle.length === 0) return 0;
	let count = 0;
	let offset = 0;
	while ((offset = value.indexOf(needle, offset)) !== -1) {
		count += 1;
		offset += needle.length;
	}
	return count;
}

function compareImport(left, right) {
	return compareText(left.importer, right.importer)
		|| compareText(left.specifier, right.specifier)
		|| compareText(left.kind, right.kind)
		|| compareText(left.binding, right.binding);
}
function compareDynamicLoading(left, right) {
	return compareText(left.importer, right.importer)
		|| compareText(left.warningId, right.warningId)
		|| left.count - right.count
		|| compareText(left.binding, right.binding);
}
function compareClosureImport(left, right) {
	return compareText(left.path, right.path)
		|| compareText(left.kind, right.kind)
		|| Number(left.external) - Number(right.external);
}
function compareText(left, right) { return left < right ? -1 : left > right ? 1 : 0; }
