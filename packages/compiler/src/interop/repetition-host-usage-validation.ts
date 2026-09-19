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
		'type __ViruneSnapshotEntry = __ViruneSnapshotResult extends readonly (infer TEntry)[] ? TEntry : never;',
		'type __ViruneSnapshotId = __ViruneSnapshotEntry extends { id: infer TId } ? TId : never;',
		'type __ViruneSnapshotIndex = __ViruneSnapshotEntry extends { index: infer TIndex } ? TIndex : never;',
		'__viruneRequireSafe<__ViruneSnapshotId>(true);',
		'__viruneRequireSafe<__ViruneSnapshotIndex>(true);',
		'declare const __viruneSnapshotId: __ViruneSnapshotId;',
		'declare const __viruneSnapshotIndex: __ViruneSnapshotIndex;',
		'declare const __viruneStringIdentity: string;',
		'declare const __viruneNumberIndex: number;',
		'const __viruneSnapshotIdAsString: string = __viruneSnapshotId;',
		'const __viruneStringAsSnapshotId: __ViruneSnapshotId = __viruneStringIdentity;',
		'const __viruneSnapshotIndexAsNumber: number = __viruneSnapshotIndex;',
		'const __viruneNumberAsSnapshotIndex: __ViruneSnapshotIndex = __viruneNumberIndex;',
		'void __viruneSnapshotIdAsString; void __viruneStringAsSnapshotId; void __viruneSnapshotIndexAsNumber; void __viruneNumberAsSnapshotIndex;',
		'function __viruneRequireGenericHost<T>(__viruneValue: T, __viruneIndex: number, __viruneSnapshotIdentity: string): void {',
		'  const __viruneGenericResult = __viruneRepetitionHost(',
		'    () => [{ id: __viruneSnapshotIdentity, index: __viruneIndex, value: __viruneValue }],',
		'    (__viruneReadValue, __viruneReadIndex, __viruneGroupIdentity) => {',
		'      const __viruneRoundTripValue: T = __viruneReadValue();',
		'      const __viruneValueRoundTrip: ReturnType<typeof __viruneReadValue> = __viruneValue;',
		'      const __viruneRoundTripIndex: number = __viruneReadIndex();',
		'      const __viruneIndexRoundTrip: ReturnType<typeof __viruneReadIndex> = __viruneIndex;',
		'      const __viruneRoundTripId: string = __viruneGroupIdentity;',
		'      const __viruneIdRoundTrip: typeof __viruneGroupIdentity = __viruneSnapshotIdentity;',
		'      void __viruneRoundTripValue; void __viruneValueRoundTrip; void __viruneRoundTripIndex; void __viruneIndexRoundTrip; void __viruneRoundTripId; void __viruneIdRoundTrip;',
		'      return <virune-probe />;',
		'    },',
		'  );',
		'  void __viruneGenericResult;',
		'}',
		'__viruneRequireGenericHost({ marker: "virune-generic-probe" }, 0, "s:virune-generic-probe");',
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
