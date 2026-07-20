import assert from 'node:assert/strict';
import test from 'node:test';
import {
	defaultEditorInformationSettings,
	resolveEditorInformationSettings,
} from '../src/editor-information.js';

test('resolveEditorInformationSettings uses stable defaults', () => {
	assert.deepEqual(resolveEditorInformationSettings(undefined), defaultEditorInformationSettings);
});

test('resolveEditorInformationSettings reads VS Code nested settings', () => {
	const settings = resolveEditorInformationSettings({
		virune: {
			inlayHints: {
				variableTypes: { enabled: false },
				functionReturnTypes: { enabled: false },
				parameterNames: 'all',
				forLoopVariableTypes: { enabled: false },
				lambdaParameterTypes: { enabled: false },
			},
			hover: {
				showEffects: false,
				showModule: false,
			},
		},
	});
	assert.deepEqual(settings, {
		inlayHints: {
			variableTypes: false,
			functionReturnTypes: false,
			parameterNames: 'all',
			forLoopVariableTypes: false,
			lambdaParameterTypes: false,
		},
		hover: {
			showEffects: false,
			showModule: false,
		},
	});
});
