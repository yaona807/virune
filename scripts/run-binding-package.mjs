import { generateBindings } from '../packages/cli/dist/src/bind.js';

const [cwd, input, output, moduleSpecifier] = process.argv.slice(2);
if (cwd === undefined || input === undefined || output === undefined || moduleSpecifier === undefined) throw new Error('Usage: run-binding-package <cwd> <input> <output> <module>');
const result = await generateBindings({ cwd, input, output, moduleSpecifier });
console.log(JSON.stringify({
	generatedFunctions: result.generatedFunctions,
	generatedRecords: result.generatedRecords,
	warnings: result.warnings.length,
	unknownMappings: result.unknownMappings,
}));
