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
};

export function resolveEditorInformationSettings(value: unknown): EditorInformationSettings {
	const root = objectValue(value);
	const virune = objectValue(root?.virune) ?? root;
	const inlayHints = objectValue(virune?.inlayHints);
	const hover = objectValue(virune?.hover);
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
