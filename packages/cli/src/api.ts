import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import { buildProject, loadConfig, type AttributeNode, type Declaration, type ModuleNode, type TypeReferenceNode } from '@virune/compiler/experimental';
import { TypeScriptInteropProvider } from '@virune/js-interop';

export interface ApiSnapshotOptions {
	readonly root: string;
	readonly output?: string;
	readonly check?: boolean;
}

interface ApiAttribute {
	readonly name: string;
	readonly arguments: readonly string[];
}

interface ApiDeclaration {
	readonly kind: string;
	readonly name: string;
	readonly signature: string;
	readonly attributes: readonly ApiAttribute[];
}

interface ApiModule {
	readonly path: string;
	readonly declarations: readonly ApiDeclaration[];
}

interface ApiSnapshot {
	readonly schemaVersion: 1;
	readonly languageVersion: string;
	readonly modules: readonly ApiModule[];
}

export async function createApiSnapshot(options: ApiSnapshotOptions): Promise<{ readonly path: string; readonly snapshot: ApiSnapshot; readonly changed: boolean }> {
	const root = resolve(options.root);
	const config = await loadConfig(root);
	const sources = await collectViruneFiles(resolve(root, config.sourceDir));
	const result = await buildProject(root, { write: false, additionalEntries: sources, jsInteropProvider: new TypeScriptInteropProvider({ projectRoot: root }) });
	const errors = result.diagnostics.filter(diagnostic => diagnostic.severity === 'error');
	if (errors.length > 0) throw new Error(`Cannot create API snapshot because the project has ${errors.length} compilation error(s)`);
	const sourceRoot = resolve(root, result.config.sourceDir);
	const modules = result.modules
		.filter(module => module.ast !== undefined && isInside(sourceRoot, resolve(module.source.path)))
		.map(module => snapshotModule(module.ast!, relative(sourceRoot, module.source.path).replaceAll('\\', '/')))
		.filter(module => module.declarations.length > 0)
		.sort((left, right) => left.path.localeCompare(right.path));
	const snapshot: ApiSnapshot = { schemaVersion: 1, languageVersion: result.config.languageVersion, modules };
	const path = resolve(root, options.output ?? 'virune.api.json');
	const text = `${JSON.stringify(snapshot, null, 2)}\n`;
	let previous: string | undefined;
	try { previous = await readFile(path, 'utf8'); } catch {}
	const changed = previous !== text;
	if (options.check) {
		if (changed) throw new Error(`Public API snapshot is out of date: ${path}`);
	} else { await mkdir(dirname(path), { recursive: true }); await writeFile(path, text, 'utf8'); }
	return { path, snapshot, changed };
}

function snapshotModule(module: ModuleNode, path: string): ApiModule {
	const declarations = module.declarations
		.filter(isPublicDeclaration)
		.map(snapshotDeclaration)
		.sort((left, right) => left.name.localeCompare(right.name) || left.kind.localeCompare(right.kind));
	return { path, declarations };
}

function isPublicDeclaration(declaration: Declaration): boolean {
	return 'public' in declaration && declaration.public === true;
}

function snapshotDeclaration(declaration: Declaration): ApiDeclaration {
	const attributes = 'attributes' in declaration ? declaration.attributes.map(snapshotAttribute) : [];
	switch (declaration.kind) {
		case 'FunctionDeclaration': {
			const typeParameters = declaration.typeParameters.length === 0 ? '' : `<${declaration.typeParameters.map(item => item.name).join(', ')}>`;
			const parameters = declaration.parameters.map(parameter => `${parameter.name}: ${typeReference(parameter.type)}`).join(', ');
			const result = declaration.returnType === undefined ? '<inferred>' : typeReference(declaration.returnType);
			const effects = declaration.effects.length === 0 ? '' : ` uses ${declaration.effects.join(', ')}`;
			return { kind: 'function', name: declaration.name, signature: `${declaration.async ? 'async ' : ''}fn ${declaration.name}${typeParameters}(${parameters}) -> ${result}${effects}`, attributes };
		}
		case 'RecordDeclaration':
			return { kind: 'record', name: declaration.name, signature: `record ${declaration.name}${typeParameters(declaration.typeParameters)}${deriveClause(declaration.derives)} { ${declaration.fields.map(field => `${field.name}: ${typeReference(field.type)}`).join(', ')} }`, attributes };
		case 'EnumDeclaration':
			return { kind: 'enum', name: declaration.name, signature: `enum ${declaration.name}${typeParameters(declaration.typeParameters)}${deriveClause(declaration.derives)} { ${declaration.variants.map(variant => `${variant.name}${variant.values.length === 0 ? '' : `(${variant.values.map(typeReference).join(', ')})`}`).join(', ')} }`, attributes };
		case 'NewtypeDeclaration': return { kind: 'newtype', name: declaration.name, signature: `newtype ${declaration.name} = ${typeReference(declaration.underlying)}`, attributes };
		case 'TypeAliasDeclaration': return { kind: 'type', name: declaration.name, signature: `type ${declaration.name}${typeParameters(declaration.typeParameters)} = ${typeReference(declaration.target)}`, attributes };
		case 'TopLevelLetDeclaration': return { kind: 'const', name: declaration.name, signature: `const ${declaration.name}: ${declaration.annotation === undefined ? '<inferred>' : typeReference(declaration.annotation)}`, attributes };
		default: throw new Error(`Unsupported public declaration ${declaration.kind}`);
	}
}

function snapshotAttribute(attribute: AttributeNode): ApiAttribute {
	return { name: attribute.name, arguments: attribute.arguments.map(argument => literal(argument)) };
}

function literal(value: AttributeNode['arguments'][number]): string {
	if (value.kind !== 'LiteralExpression') return `<${value.kind}>`;
	switch (value.literalKind) {
		case 'String': return JSON.stringify(value.value);
		case 'BigInt': return `${String(value.value)}n`;
		default: return String(value.value);
	}
}

function typeParameters(parameters: readonly { readonly name: string }[]): string {
	return parameters.length === 0 ? '' : `<${parameters.map(item => item.name).join(', ')}>`;
}

function deriveClause(derives: readonly string[]): string { return derives.length === 0 ? '' : ` derives ${derives.join(', ')}`; }

function typeReference(reference: TypeReferenceNode): string {
	if (reference.name === '$Tuple') return `(${reference.arguments.map(typeReference).join(', ')})${reference.optional ? '?' : ''}`;
	const argumentsList = reference.arguments.length === 0 ? '' : `<${reference.arguments.map(typeReference).join(', ')}>`;
	return `${reference.name}${argumentsList}${reference.optional ? '?' : ''}`;
}

function isInside(root: string, target: string): boolean {
	const path = relative(root, target);
	return path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !path.startsWith(sep));
}

async function collectViruneFiles(path: string): Promise<string[]> {
	const info = await stat(path);
	if (info.isFile()) return path.endsWith('.virune') ? [path] : [];
	const files: string[] = [];
	for (const entry of await readdir(path, { withFileTypes: true })) {
		if (['node_modules', 'dist', '.git', '.virune-cache'].includes(entry.name)) continue;
		const child = resolve(path, entry.name);
		if (entry.isDirectory()) files.push(...await collectViruneFiles(child));
		else if (entry.name.endsWith('.virune')) files.push(child);
	}
	return files.sort();
}
