import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { isAbsolute, resolve, sep } from 'node:path';

export function createReviewedRepositorySourceReader(repositoryRoot, reviewedCommit) {
	if (typeof repositoryRoot !== 'string' || repositoryRoot.length === 0) {
		throw new Error('repositoryRoot must be a non-empty path');
	}
	if (reviewedCommit !== undefined) {
		if (!/^[0-9a-f]{40}$/u.test(reviewedCommit)) throw new Error('reviewedCommit must be a full commit SHA');
		const verification = spawnSync('git', ['rev-parse', '--verify', `${reviewedCommit}^{commit}`], {
			cwd: repositoryRoot,
			encoding: 'utf8',
		});
		if (verification.error !== undefined) throw new Error(`Failed to verify reviewed commit ${reviewedCommit}: ${verification.error.message}`);
		if ((verification.status ?? 1) !== 0 || verification.stdout.trim() !== reviewedCommit) {
			throw new Error(`Reviewed commit ${reviewedCommit} is not available in the repository`);
		}
	}

	return {
		async read(sourcePath, { optional = false } = {}) {
			assertRepositoryRelativePath(sourcePath);
			if (reviewedCommit === undefined) {
				try {
					return await readFile(resolve(repositoryRoot, ...sourcePath.split('/')));
				} catch (error) {
					if (optional && error?.code === 'ENOENT') return undefined;
					throw error;
				}
			}

			const listing = spawnSync('git', ['ls-tree', '-z', '--name-only', reviewedCommit, '--', sourcePath], {
				cwd: repositoryRoot,
				encoding: null,
				maxBuffer: 16 * 1024 * 1024,
			});
			if (listing.error !== undefined) {
				throw new Error(`Failed to inspect reviewed source ${sourcePath} from ${reviewedCommit}: ${listing.error.message}`);
			}
			if ((listing.status ?? 1) !== 0) {
				throw new Error(`Failed to inspect reviewed source ${sourcePath} from ${reviewedCommit}: ${(listing.stderr ?? Buffer.alloc(0)).toString('utf8').trim()}`);
			}
			const listedPaths = (listing.stdout ?? Buffer.alloc(0)).toString('utf8').split('\0').filter(Boolean);
			if (listedPaths.length === 0) {
				if (optional) return undefined;
				throw new Error(`Failed to read reviewed source ${sourcePath} from ${reviewedCommit}: path is absent from the reviewed commit`);
			}
			if (listedPaths.length !== 1 || listedPaths[0] !== sourcePath) {
				throw new Error(`Reviewed source lookup for ${sourcePath} from ${reviewedCommit} returned an unexpected path set`);
			}

			const result = spawnSync('git', ['show', `${reviewedCommit}:${sourcePath}`], {
				cwd: repositoryRoot,
				encoding: null,
				maxBuffer: 16 * 1024 * 1024,
			});
			if (result.error !== undefined) throw new Error(`Failed to read reviewed source ${sourcePath} from ${reviewedCommit}: ${result.error.message}`);
			if ((result.status ?? 1) !== 0) {
				throw new Error(`Failed to read reviewed source ${sourcePath} from ${reviewedCommit}: ${(result.stderr ?? Buffer.alloc(0)).toString('utf8').trim()}`);
			}
			return result.stdout;
		},
	};
}

function assertRepositoryRelativePath(sourcePath) {
	if (
		typeof sourcePath !== 'string'
		|| sourcePath.length === 0
		|| isAbsolute(sourcePath)
		|| sourcePath.includes('\\')
		|| sourcePath.split('/').some(segment => segment === '' || segment === '.' || segment === '..')
	) {
		throw new Error(`sourcePath must be a normalized repository-relative path; received ${JSON.stringify(sourcePath)}`);
	}
	if (sep !== '/' && sourcePath.includes(sep)) {
		throw new Error(`sourcePath must use forward slashes; received ${JSON.stringify(sourcePath)}`);
	}
}
