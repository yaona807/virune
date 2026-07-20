import { buildProject, ProjectBuildCache, type BuildProjectOptions, type ProjectBuildResult } from './project.js';

/** Stateful project compiler used by editors and watch-mode integrations. */
export class IncrementalProjectBuilder {
	readonly #cache = new ProjectBuildCache();

	public async build(rootDirectory: string, options: Omit<BuildProjectOptions, 'incrementalCache'> = {}): Promise<ProjectBuildResult> {
		return buildProject(rootDirectory, { ...options, incrementalCache: this.#cache });
	}

	public invalidate(path?: string): void {
		this.#cache.invalidate(path);
	}

	public clear(): void {
		this.#cache.clear();
	}
}
