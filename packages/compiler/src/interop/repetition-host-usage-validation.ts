import type { JsInteropProvider, JsImportRequest } from './types.js';

interface RepetitionHostTypeScriptUsageOptions {
	readonly containingFile: string;
	readonly platform: JsImportRequest['platform'];
	readonly moduleSpecifier: string;
	readonly exportName: string;
	readonly jsInteropProvider?: JsInteropProvider;
}

export function validateRepetitionHostTypeScriptUsage(options: RepetitionHostTypeScriptUsageOptions): boolean {
	const provider = options.jsInteropProvider;
	const resolver = provider?.resolveJsxUsage;
	if (provider === undefined || resolver === undefined) return false;
	const moduleSpecifier = JSON.stringify(options.moduleSpecifier);
	const exportName = JSON.stringify(options.exportName);
	const sourceText = [
		`import * as __viruneRepetitionHostModule from ${moduleSpecifier};`,
		`const __viruneRepetitionHost = __viruneRepetitionHostModule[${exportName}];`,
		'type __ViruneIsAny<T> = 0 extends (1 & T) ? true : false;',
		'type __ViruneIsUnknown<T> = __ViruneIsAny<T> extends true ? false : unknown extends T ? ([keyof T] extends [never] ? true : false) : false;',
		'type __ViruneSafe<T> = __ViruneIsAny<T> extends true ? never : __ViruneIsUnknown<T> extends true ? never : true;',
		'function __viruneRequireSafe<T>(_proof: __ViruneSafe<T>): void {}',
		'__viruneRequireSafe<typeof __viruneRepetitionHost>(true);',
		'type __ViruneHostParameters = Parameters<typeof __viruneRepetitionHost>;',
		'__viruneRequireSafe<__ViruneHostParameters[0]>(true);',
		'__viruneRequireSafe<__ViruneHostParameters[1]>(true);',
		'type __ViruneSnapshotResult = __ViruneHostParameters[0] extends (...args: never[]) => infer TResult ? TResult : never;',
		'__viruneRequireSafe<__ViruneSnapshotResult>(true);',
		'const __viruneRepetitionHostResult = __viruneRepetitionHost(',
		'  () => [{ id: "s:virune-probe", index: 0, value: { marker: "virune-probe" } }],',
		'  (__viruneReadValue, __viruneReadIndex, __viruneIdentity) => {',
		'    __viruneRequireSafe<typeof __viruneReadValue>(true);',
		'    __viruneRequireSafe<ReturnType<typeof __viruneReadValue>>(true);',
		'    __viruneRequireSafe<typeof __viruneReadIndex>(true);',
		'    __viruneRequireSafe<ReturnType<typeof __viruneReadIndex>>(true);',
		'    __viruneRequireSafe<typeof __viruneIdentity>(true);',
		'    const __viruneMarker: string = __viruneReadValue().marker;',
		'    const __viruneIndex: number = __viruneReadIndex();',
		'    const __viruneId: string = __viruneIdentity;',
		'    void __viruneMarker; void __viruneIndex; void __viruneId;',
		'    return <virune-probe />;',
		'  },',
		');',
		'__viruneRequireSafe<typeof __viruneRepetitionHostResult>(true);',
		'void __viruneRepetitionHostResult;',
		'declare global { namespace JSX { interface IntrinsicElements { "virune-probe": Record<string, never>; } } }',
	].join('\n');
	try {
		return resolver.call(provider, {
			containingFile: options.containingFile,
			platform: options.platform,
			sourceText,
		})?.accepted === true;
	} catch {
		return false;
	}
}
