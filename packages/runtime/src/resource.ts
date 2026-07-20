export class ResourceCleanupError extends Error {
	public constructor(
		readonly primary: unknown,
		readonly cleanupErrors: readonly unknown[],
	) {
		super(`Resource cleanup failed with ${cleanupErrors.length} error(s)`);
		this.name = 'ResourceCleanupError';
	}
}

export type CleanupAction = () => unknown;
export type AsyncCleanupAction = () => unknown | Promise<unknown>;

export function runDefers(actions: readonly CleanupAction[], primary?: unknown): void {
	const errors: unknown[] = [];
	for (let index = actions.length - 1; index >= 0; index--) {
		try { actions[index]!(); }
		catch (error) { errors.push(error); }
	}
	if (errors.length > 0) throw new ResourceCleanupError(primary, errors);
}

export async function runDefersAsync(actions: readonly AsyncCleanupAction[], primary?: unknown): Promise<void> {
	const errors: unknown[] = [];
	for (let index = actions.length - 1; index >= 0; index--) {
		try { await actions[index]!(); }
		catch (error) { errors.push(error); }
	}
	if (errors.length > 0) throw new ResourceCleanupError(primary, errors);
}
