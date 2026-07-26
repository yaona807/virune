import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function writeReleaseRepairAudit({
	beforeDirectory,
	afterDirectory,
	output,
	tag,
	reason,
	actor,
	targetCommit,
	workflowRun,
	generatedAt = new Date().toISOString(),
}) {
	for (const [name, value] of Object.entries({ tag, reason, actor, targetCommit, workflowRun })) {
		if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`Release repair audit requires ${name}.`);
	}
	const before = inventory(beforeDirectory);
	const after = inventory(afterDirectory);
	const beforeByName = new Map(before.map(item => [item.file, item]));
	const changes = after.map(item => {
		const previous = beforeByName.get(item.file);
		return {
			file: item.file,
			before: previous ?? null,
			after: item,
			changed: previous === undefined || previous.sha256 !== item.sha256 || previous.bytes !== item.bytes,
		};
	});
	for (const previous of before) {
		if (!after.some(item => item.file === previous.file)) {
			changes.push({ file: previous.file, before: previous, after: null, changed: true });
		}
	}
	changes.sort((left, right) => left.file.localeCompare(right.file));
	const audit = {
		schemaVersion: 1,
		action: 'replace-stable-release-assets',
		tag,
		reason: reason.trim(),
		actor,
		targetCommit,
		workflowRun,
		generatedAt,
		before,
		after,
		changes,
		changedFiles: changes.filter(change => change.changed).map(change => change.file),
	};
	mkdirSync(dirname(output), { recursive: true });
	writeFileSync(output, `${JSON.stringify(audit, null, 2)}\n`, 'utf8');
	console.log(`Wrote release repair audit with ${audit.changedFiles.length} changed assets: ${output}`);
	return audit;
}

function inventory(directory) {
	return readdirSync(directory)
		.filter(file => statSync(resolve(directory, file)).isFile())
		.sort()
		.map(file => {
			const bytes = readFileSync(resolve(directory, file));
			return {
				file,
				sha256: createHash('sha256').update(bytes).digest('hex'),
				bytes: bytes.byteLength,
			};
		});
}

const entry = process.argv[1] === undefined ? undefined : resolve(process.argv[1]);
if (entry === fileURLToPath(import.meta.url)) {
	writeReleaseRepairAudit({
		beforeDirectory: resolve(process.env.VIRUNE_REPAIR_BEFORE ?? '.cache/release-repair/before'),
		afterDirectory: resolve(process.env.VIRUNE_REPAIR_AFTER ?? 'release'),
		output: resolve(process.env.VIRUNE_REPAIR_AUDIT ?? '.cache/release-repair/audit.json'),
		tag: process.env.VIRUNE_REPAIR_TAG,
		reason: process.env.VIRUNE_REPAIR_REASON,
		actor: process.env.GITHUB_ACTOR,
		targetCommit: process.env.VIRUNE_REPAIR_COMMIT,
		workflowRun: process.env.VIRUNE_REPAIR_RUN,
	});
}
