import { spawn } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const MODES = new Set(['compile', 'run', 'compile-fail', 'ignore']);
const SYNCHRONIZATION_MODES = new Set(['exact', 'structure']);
const FENCE_PATTERN = /^```virune(?:[ \t]+([^\r\n]*))?\r?\n([\s\S]*?)^```\s*$/gmu;
const ATTRIBUTE_PATTERN = /\s+([a-z][a-z0-9-]*)=(?:"((?:\\.|[^"])*)"|'((?:\\.|[^'])*)'|([^\s]+))/gyu;

export async function verifyDocumentationExamples(root = DEFAULT_ROOT, options = {}) {
	const execute = options.execute ?? true;
	const manifestPath = resolve(root, 'docs/documentation-examples.json');
	const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
	if (manifest.schemaVersion !== 1 || !isRecord(manifest.documents) || !Array.isArray(manifest.inlineDocuments)) {
		throw new Error('Invalid docs/documentation-examples.json');
	}

	const documentPaths = [...new Set([...Object.keys(manifest.documents), ...manifest.inlineDocuments])].sort();
	const documents = new Map();
	for (const documentPath of documentPaths) {
		const source = await readFile(resolve(root, documentPath), 'utf8');
		const examples = buildDocumentExamples(documentPath, source, manifest.documents[documentPath] ?? []);
		documents.set(documentPath, examples);
	}
	verifyCounterpartDrift(documents);

	let executed = 0;
	let ignored = 0;
	if (execute) {
		const cacheRoot = resolve(root, '.cache/documentation-examples');
		await rm(cacheRoot, { recursive: true, force: true });
		await mkdir(cacheRoot, { recursive: true });
		for (const [documentPath, document] of documents) {
			for (const example of document.examples.values()) {
				if (example.mode === 'ignore') {
					ignored += 1;
					continue;
				}
				await executeExample(root, cacheRoot, documentPath, document, example);
				executed += 1;
			}
		}
	}

	const fenceCount = [...documents.values()].reduce((total, document) => total + document.fences.length, 0);
	console.log(`Verified ${fenceCount} Virune documentation fences across ${documents.size} documents (${executed} executed, ${ignored} ignored).`);
	return { documents, executed, ignored, fenceCount };
}

export function collectViruneFences(source) {
	const fences = [];
	for (const match of source.matchAll(FENCE_PATTERN)) {
		fences.push({
			index: fences.length,
			line: source.slice(0, match.index).split('\n').length,
			info: (match[1] ?? '').trim(),
			source: normalizeNewlines(match[2]).replace(/\s*$/u, '') + '\n',
		});
	}
	return fences;
}

export function parseInlineDirective(info, context = 'directive') {
	const modeMatch = /^(compile-fail|compile|run|ignore)(?=\s|$)/u.exec(info);
	if (modeMatch === null) throw new Error(`${context}: directive must start with compile, run, compile-fail, or ignore`);
	const raw = { mode: modeMatch[1] };
	let cursor = modeMatch[0].length;
	while (cursor < info.length) {
		ATTRIBUTE_PATTERN.lastIndex = cursor;
		const match = ATTRIBUTE_PATTERN.exec(info);
		if (match === null) throw new Error(`${context}: invalid directive syntax near ${JSON.stringify(info.slice(cursor))}`);
		const key = match[1];
		if (Object.hasOwn(raw, key)) throw new Error(`${context}: duplicate ${key} attribute`);
		raw[key] = decodeAttribute(match[2] ?? match[3] ?? match[4]);
		cursor = ATTRIBUTE_PATTERN.lastIndex;
	}
	return normalizeDirective(raw, context);
}

export function buildDocumentExamples(documentPath, source, manifestDirectives = []) {
	if (!Array.isArray(manifestDirectives)) throw new Error(`${documentPath}: manifest directives must be an array`);
	const fences = collectViruneFences(source);
	const manifestByIndex = new Map();
	for (const raw of manifestDirectives) {
		if (!Number.isInteger(raw.index) || raw.index < 0) throw new Error(`${documentPath}: manifest directive index must be a non-negative integer`);
		if (manifestByIndex.has(raw.index)) throw new Error(`${documentPath}: duplicate manifest directive for fence ${raw.index}`);
		manifestByIndex.set(raw.index, normalizeDirective(raw, `${documentPath} fence ${raw.index}`));
	}

	const examples = new Map();
	for (const fence of fences) {
		const manifestDirective = manifestByIndex.get(fence.index);
		if (fence.info !== '' && manifestDirective !== undefined) {
			throw new Error(`${documentPath}:${fence.line}: fence ${fence.index} has both inline and manifest directives`);
		}
		const directive = fence.info === ''
			? manifestDirective
			: parseInlineDirective(fence.info, `${documentPath}:${fence.line}`);
		if (directive === undefined) throw new Error(`${documentPath}:${fence.line}: Virune fence ${fence.index} has no validation directive`);
		manifestByIndex.delete(fence.index);
		const example = examples.get(directive.id) ?? createExample(documentPath, directive);
		mergeDirective(example, directive, `${documentPath}:${fence.line}`);
		example.blocks.push({
			file: directive.file,
			include: directive.include,
			fence,
		});
		examples.set(directive.id, example);
	}
	if (manifestByIndex.size > 0) {
		throw new Error(`${documentPath}: manifest references missing Virune fences: ${[...manifestByIndex.keys()].join(', ')}`);
	}
	for (const example of examples.values()) validateExample(example);
	return { documentPath, source, fences, examples };
}

export function verifyCounterpartDrift(documents) {
	for (const [documentPath, document] of documents) {
		if (documentPath.endsWith('_ja.md')) continue;
		const counterpartPath = documentPath.replace(/\.md$/u, '_ja.md');
		const counterpart = documents.get(counterpartPath);
		if (counterpart === undefined) continue;
		const ids = [...document.examples.keys()].sort();
		const counterpartIds = [...counterpart.examples.keys()].sort();
		if (JSON.stringify(ids) !== JSON.stringify(counterpartIds)) {
			throw new Error(`${documentPath} and ${counterpartPath} have different documentation example IDs`);
		}
		for (const id of ids) {
			const left = document.examples.get(id);
			const right = counterpart.examples.get(id);
			if (left.sync !== right.sync) throw new Error(`${documentPath}#${id} and ${counterpartPath}#${id} use different sync modes`);
			const leftSignature = counterpartSignature(document, left);
			const rightSignature = counterpartSignature(counterpart, right);
			if (JSON.stringify(leftSignature) !== JSON.stringify(rightSignature)) {
				throw new Error(`${documentPath}#${id} and ${counterpartPath}#${id} have drifted`);
			}
		}
	}
}

function normalizeDirective(raw, context) {
	if (!isRecord(raw)) throw new Error(`${context}: directive must be an object`);
	const allowed = new Set(['index', 'mode', 'id', 'file', 'stdout', 'stderr', 'exit', 'match', 'reason', 'sync', 'include']);
	for (const key of Object.keys(raw)) {
		if (!allowed.has(key)) throw new Error(`${context}: unsupported directive attribute ${key}`);
	}
	if (!MODES.has(raw.mode)) throw new Error(`${context}: unsupported mode ${raw.mode}`);
	if (typeof raw.id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/u.test(raw.id)) throw new Error(`${context}: id must use lowercase letters, digits, and hyphens`);
	const file = raw.file ?? 'src/main.virune';
	if (typeof file !== 'string' || !/^src\/(?!.*(?:^|\/)\.\.(?:\/|$)).+\.virune$/u.test(file)) {
		throw new Error(`${context}: file must be a safe path below src/ ending in .virune`);
	}
	const sync = raw.sync ?? 'exact';
	if (!SYNCHRONIZATION_MODES.has(sync)) throw new Error(`${context}: sync must be exact or structure`);
	const include = raw.include ?? [];
	if (!Array.isArray(include) || include.some(index => !Number.isInteger(index) || index < 0)) {
		throw new Error(`${context}: include must contain non-negative fence indexes`);
	}
	const exit = raw.exit === undefined ? undefined : Number(raw.exit);
	if (exit !== undefined && (!Number.isInteger(exit) || exit < 0 || exit > 255)) throw new Error(`${context}: exit must be an integer from 0 to 255`);
	for (const key of ['stdout', 'stderr', 'match', 'reason']) {
		if (raw[key] !== undefined && typeof raw[key] !== 'string') throw new Error(`${context}: ${key} must be a string`);
	}
	return {
		mode: raw.mode,
		id: raw.id,
		file,
		stdout: raw.stdout,
		stderr: raw.stderr,
		exit,
		match: raw.match,
		reason: raw.reason,
		sync,
		include: [...include],
	};
}

function createExample(documentPath, directive) {
	return {
		documentPath,
		id: directive.id,
		mode: directive.mode,
		sync: directive.sync,
		stdout: directive.stdout,
		stderr: directive.stderr,
		exit: directive.exit,
		match: directive.match,
		reason: directive.reason,
		blocks: [],
	};
}

function mergeDirective(example, directive, context) {
	for (const key of ['mode', 'sync', 'stdout', 'stderr', 'exit', 'match', 'reason']) {
		const current = example[key];
		const incoming = directive[key];
		if (incoming === undefined) continue;
		if (current !== undefined && current !== incoming) throw new Error(`${context}: conflicting ${key} for example ${example.id}`);
		example[key] = incoming;
	}
}

function validateExample(example) {
	if (example.blocks.length === 0) throw new Error(`${example.documentPath}#${example.id}: example has no source blocks`);
	if (example.mode === 'ignore') {
		if (typeof example.reason !== 'string' || example.reason.trim() === '') {
			throw new Error(`${example.documentPath}#${example.id}: ignore requires a non-empty reason`);
		}
		return;
	}
	if (example.reason !== undefined) throw new Error(`${example.documentPath}#${example.id}: reason is only valid for ignore`);
	if (example.mode === 'compile-fail' && (typeof example.match !== 'string' || example.match === '')) {
		throw new Error(`${example.documentPath}#${example.id}: compile-fail requires a diagnostic match`);
	}
}

function materializeFiles(document, example) {
	const files = new Map();
	for (const block of example.blocks) {
		const pieces = [];
		for (const index of block.include) {
			const included = document.fences[index];
			if (included === undefined) throw new Error(`${example.documentPath}#${example.id}: include references missing fence ${index}`);
			if (index === block.fence.index) throw new Error(`${example.documentPath}#${example.id}: a fence cannot include itself`);
			pieces.push(included.source);
		}
		pieces.push(block.fence.source);
		const previous = files.get(block.file);
		files.set(block.file, previous === undefined ? pieces.join('\n') : `${previous}\n${pieces.join('\n')}`);
	}
	return files;
}

function counterpartSignature(document, example) {
	const transform = example.sync === 'exact' ? normalizeNewlines : normalizeStructure;
	const files = [...materializeFiles(document, example)]
		.map(([path, source]) => [path, transform(source)])
		.sort(([left], [right]) => left.localeCompare(right));
	return {
		mode: example.mode,
		files,
		exit: expectedExit(example),
		stdout: example.sync === 'exact' ? example.stdout ?? null : example.stdout === undefined ? null : '<set>',
		stderr: example.sync === 'exact' ? example.stderr ?? null : example.stderr === undefined ? null : '<set>',
		match: example.sync === 'exact' ? example.match ?? null : example.match === undefined ? null : '<set>',
		reason: example.mode === 'ignore' ? '<required>' : null,
	};
}

async function executeExample(root, cacheRoot, documentPath, document, example) {
	const projectName = sanitize(`${documentPath}-${example.id}`);
	const projectRoot = resolve(cacheRoot, projectName);
	const files = materializeFiles(document, example);
	await mkdir(projectRoot, { recursive: true });
	for (const [path, source] of files) {
		const destination = resolve(projectRoot, path);
		await mkdir(dirname(destination), { recursive: true });
		await writeFile(destination, source);
	}
	const entry = files.has('src/main.virune') ? 'src/main.virune' : [...files.keys()].sort()[0];
	await writeFile(resolve(projectRoot, 'virune.json'), `${JSON.stringify({
		languageVersion: '1.0',
		platform: 'node',
		sourceDir: 'src',
		outDir: 'dist',
		entry,
		target: 'es2022',
		sourceMap: true,
		sourcesContent: true,
	}, null, 2)}\n`);

	const commandName = example.mode === 'run' ? 'run' : 'check';
	const cliPath = resolve(root, 'packages/cli/dist/src/main.js');
	const command = [cliPath, commandName, projectRoot];
	const result = await spawnCapture(process.execPath, command, root);
	const context = `${documentPath}:${example.blocks[0].fence.line} [${example.id}]`;
	const displayedCommand = `node ${relative(root, cliPath)} ${commandName} ${relative(root, projectRoot)}`;
	const failures = [];
	if (example.mode === 'compile-fail') {
		if (result.exitCode === 0) failures.push('expected compilation to fail, but it succeeded');
		if (!`${result.stdout}\n${result.stderr}`.includes(example.match)) failures.push(`diagnostic did not contain ${JSON.stringify(example.match)}`);
	} else if (result.exitCode !== expectedExit(example)) {
		failures.push(`expected exit ${expectedExit(example)}, received ${result.exitCode}`);
	}
	if (example.stdout !== undefined && result.stdout !== normalizeNewlines(example.stdout)) failures.push('stdout did not match');
	if (example.stderr !== undefined && result.stderr !== normalizeNewlines(example.stderr)) failures.push('stderr did not match');
	if (failures.length > 0) {
		throw new Error([
			`${context}: ${failures.join('; ')}`,
			`command: ${displayedCommand}`,
			`stdout:\n${indent(result.stdout || '<empty>')}`,
			`stderr:\n${indent(result.stderr || '<empty>')}`,
		].join('\n'));
	}
}

function spawnCapture(command, argumentsList, cwd) {
	return new Promise((resolvePromise, reject) => {
		const child = spawn(command, argumentsList, { cwd, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
		let stdout = '';
		let stderr = '';
		const timeout = setTimeout(() => child.kill(), 30000);
		child.stdout.setEncoding('utf8');
		child.stderr.setEncoding('utf8');
		child.stdout.on('data', chunk => { stdout += chunk; });
		child.stderr.on('data', chunk => { stderr += chunk; });
		child.once('error', error => {
			clearTimeout(timeout);
			reject(error);
		});
		child.once('exit', code => {
			clearTimeout(timeout);
			resolvePromise({
				exitCode: code ?? 1,
				stdout: normalizeNewlines(stdout),
				stderr: normalizeNewlines(stderr),
			});
		});
	});
}

function expectedExit(example) {
	if (example.mode === 'compile-fail') return example.exit ?? 1;
	return example.exit ?? 0;
}

function normalizeStructure(source) {
	return normalizeNewlines(source)
		.replace(/\/\/[^\n]*/gu, '//')
		.replace(/"(?:\\.|[^"\\])*"/gu, '"<string>"')
		.replace(/[ \t]+$/gmu, '')
		.trim();
}

function decodeAttribute(value) {
	return value.replace(/\\(n|r|t|\\|"|')/gu, (_match, escape) => ({
		n: '\n',
		r: '\r',
		t: '\t',
		'\\': '\\',
		'"': '"',
		"'": "'",
	})[escape]);
}

function normalizeNewlines(value) {
	return value.replace(/\r\n?/gu, '\n');
}

function sanitize(value) {
	return value.replace(/[^a-z0-9]+/giu, '-').replace(/^-|-$/gu, '').toLowerCase();
}

function indent(value) {
	return value.split('\n').map(line => `  ${line}`).join('\n');
}

function isRecord(value) {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const entry = process.argv[1] === undefined ? undefined : resolve(process.argv[1]);
if (entry === fileURLToPath(import.meta.url)) {
	try {
		await verifyDocumentationExamples(resolve(process.argv[2] ?? DEFAULT_ROOT));
	} catch (error) {
		console.error(error instanceof Error ? error.message : error);
		process.exitCode = 1;
	}
}
