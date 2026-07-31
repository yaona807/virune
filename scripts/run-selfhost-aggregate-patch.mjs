import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const sourcePath = 'scripts/apply-selfhost-aggregate-call-ast.mjs';
let source = await readFile(sourcePath, 'utf8');
source = source.replace(
	"\t\tthrow new Error(`Frontend parser contract failed: ${JSON.stringify(encoded.$values[0])}`);",
	"\t\tthrow new Error('Frontend parser contract failed: ' + JSON.stringify(encoded.$values[0]));",
);
source = source.replace(
	"\tassert.deepEqual(errors.map(item => `${item.code}:${item.message}`), []);",
	"\tassert.deepEqual(errors.map(item => item.code + ':' + item.message), []);",
);
source = source.replace(
	"\tconst moduleUrl = `${pathToFileURL(join(root, 'main.js')).href}?test=${Date.now()}`;",
	"\tconst moduleUrl = pathToFileURL(join(root, 'main.js')).href + '?test=' + Date.now();",
);
const fixedPath = '/tmp/apply-selfhost-aggregate-call-ast.mjs';
await writeFile(fixedPath, source);
await import(pathToFileURL(fixedPath).href + '?run=' + Date.now());
