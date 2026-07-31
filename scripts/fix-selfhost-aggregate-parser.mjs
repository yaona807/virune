import { readFile, writeFile } from 'node:fs/promises';

const path = 'selfhost/mvp/src/frontend-parser-core.virune';
let source = await readFile(path, 'utf8');
const replacements = [
	['fn parseConditionalExpression(fn parseConditionalExpression(', 'fn parseConditionalExpression('],
	['fn parseExpression(fn parseExpression(', 'fn parseExpression('],
];
for (const [before, after] of replacements) {
	if (!source.includes(before)) throw new Error(`Missing parser declaration target: ${before}`);
	source = source.replace(before, after);
}
await writeFile(path, source);
