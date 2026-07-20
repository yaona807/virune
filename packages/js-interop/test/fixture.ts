import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export async function fixtureRoot(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), 'virune-interop-'));
	await mkdir(join(root, 'src'), { recursive: true });
	await writeFile(join(root, 'package.json'), '{"type":"module"}\n', 'utf8');
	await writeFile(join(root, 'src/library.js'), 'export function greet(name) { return `Hello ${name}`; }\n', 'utf8');
	await writeFile(join(root, 'src/library.d.ts'), 'export declare function greet(name: string): string;\n', 'utf8');
	await writeFile(join(root, 'src/main.virune'), '', 'utf8');
	return root;
}
