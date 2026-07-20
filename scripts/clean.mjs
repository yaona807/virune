import { readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

const root = process.cwd();

for (const path of [
	'integration/dist',
	'.virune-cache',
	'.test-tmp',
	'dist-examples',
	'release',
]) {
	await rm(join(root, path), { recursive: true, force: true });
}

await removePackageBuilds(join(root, 'packages'));
await removeExampleBuilds(join(root, 'examples'));

async function removePackageBuilds(directory) {
	for (const entry of await entries(directory)) {
		if (!entry.isDirectory()) continue;
		await rm(join(directory, entry.name, 'dist'), { recursive: true, force: true });
	}
}

async function removeExampleBuilds(directory) {
	for (const entry of await entries(directory)) {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) {
			if (entry.name === 'dist' || entry.name === '.virune-cache') {
				await rm(path, { recursive: true, force: true });
				continue;
			}
			await removeExampleBuilds(path);
			continue;
		}
		if (entry.name.endsWith('.js') || entry.name.endsWith('.js.map')) {
			await rm(path, { force: true });
		}
	}
}

async function entries(directory) {
	try {
		return await readdir(directory, { withFileTypes: true });
	} catch (error) {
		if (error?.code === 'ENOENT') return [];
		throw error;
	}
}
