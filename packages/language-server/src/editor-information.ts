export type ParameterNameHints = 'none' | 'literals' | 'all';

export interface EditorInformationSettings {
	readonly inlayHints: {
		readonly variableTypes: boolean;
		readonly functionReturnTypes: boolean;
		readonly parameterNames: ParameterNameHints;
		readonly forLoopVariableTypes: boolean;
		readonly lambdaParameterTypes: boolean;
	};
	readonly hover: {
		readonly showEffects: boolean;
		readonly showModule: boolean;
	};
	readonly codeLens: {
		readonly references: boolean;
		readonly callers: boolean;
		readonly visibility: 'public' | 'all';
	};
}

export const defaultEditorInformationSettings: EditorInformationSettings = {
	inlayHints: {
		variableTypes: true,
		functionReturnTypes: true,
		parameterNames: 'literals',
		forLoopVariableTypes: true,
		lambdaParameterTypes: true,
	},
	hover: {
		showEffects: true,
		showModule: true,
	},
	codeLens: {
		references: true,
		callers: true,
		visibility: 'public',
	},
};

export function resolveEditorInformationSettings(value: unknown): EditorInformationSettings {
	const root = objectValue(value);
	const virune = objectValue(root?.virune) ?? root;
	const inlayHints = objectValue(virune?.inlayHints);
	const hover = objectValue(virune?.hover);
	const codeLens = objectValue(virune?.codeLens);
	return {
		inlayHints: {
			variableTypes: enabledValue(inlayHints?.variableTypes, defaultEditorInformationSettings.inlayHints.variableTypes),
			functionReturnTypes: enabledValue(inlayHints?.functionReturnTypes, defaultEditorInformationSettings.inlayHints.functionReturnTypes),
			parameterNames: parameterNameValue(inlayHints?.parameterNames),
			forLoopVariableTypes: enabledValue(inlayHints?.forLoopVariableTypes, defaultEditorInformationSettings.inlayHints.forLoopVariableTypes),
			lambdaParameterTypes: enabledValue(inlayHints?.lambdaParameterTypes, defaultEditorInformationSettings.inlayHints.lambdaParameterTypes),
		},
		hover: {
			showEffects: booleanValue(hover?.showEffects, defaultEditorInformationSettings.hover.showEffects),
			showModule: booleanValue(hover?.showModule, defaultEditorInformationSettings.hover.showModule),
		},
		codeLens: {
			references: enabledValue(codeLens?.references, defaultEditorInformationSettings.codeLens.references),
			callers: enabledValue(codeLens?.callers, defaultEditorInformationSettings.codeLens.callers),
			visibility: codeLens?.visibility === 'all' ? 'all' : 'public',
		},
	};
}

function enabledValue(value: unknown, fallback: boolean): boolean {
	if (typeof value === 'boolean') return value;
	return booleanValue(objectValue(value)?.enabled, fallback);
}

function booleanValue(value: unknown, fallback: boolean): boolean {
	return typeof value === 'boolean' ? value : fallback;
}

function parameterNameValue(value: unknown): ParameterNameHints {
	return value === 'none' || value === 'literals' || value === 'all'
		? value
		: defaultEditorInformationSettings.inlayHints.parameterNames;
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
		? value as Record<string, unknown>
		: undefined;
}
