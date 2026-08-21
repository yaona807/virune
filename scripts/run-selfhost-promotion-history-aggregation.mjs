import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectPromotionWorkflowInventory, createPromotionGitHubReader } from './selfhost-promotion-github.mjs';
import {
	createPromotionObservationSnapshots,
	PROMOTION_OBSERVATION_WORKFLOW,
} from './selfhost-promotion-observation-collector.mjs';
import {
	createPromotionParentCandidates,
	PROMOTION_AGGREGATION_WORKFLOW,
} from './selfhost-promotion-parent-collector.mjs';
import { discoverPromotionHistoryParentV2 } from '../packages/compiler/dist/src/selfhost/promotion-history-parent-discovery-v2.js';
import { orchestratePromotionHistoryV2 } from '../packages/compiler/dist/src/selfhost/promotion-history-orchestrator-v2.js';

export const PROMOTION_OBSERVATION_WORKFLOW_NAME = 'Self-host promotion observation';
export const PROMOTION_OBSERVATION_WORKFLOW_PATH = '.github/workflows/selfhost-promotion-observation.yml';
export const DEFAULT_PROMOTION_HISTORY_OUTPUT = '.cache/selfhost-promotion-history';
const policyPath = '.github/self-hosting/promotion-policy-v1.json';
const stage = 'required-selfhost';
const runIdPattern = /^[1-9][0-9]*$/u;
const outputFiles = ['aggregation-report.json', 'promotion-history-ledger.json', 'aggregation-failure.json'];

const defaultDependencies = Object.freeze({
	createReader: createPromotionGitHubReader,
	collectInventory: collectPromotionWorkflowInventory,
	createSnapshots: createPromotionObservationSnapshots,
	createParentCandidates: createPromotionParentCandidates,
	discoverParent: discoverPromotionHistoryParentV2,
	orchestrate: orchestratePromotionHistoryV2,
});

export async function runPromotionHistoryAggregation({
	repositoryRoot = process.cwd(),
	environment = process.env,
	fetchImpl = fetch,
	dependencies = defaultDependencies,
} = {}) {
	const outputDirectory = resolve(repositoryRoot, environment.VIRUNE_PROMOTION_HISTORY_OUTPUT ?? DEFAULT_PROMOTION_HISTORY_OUTPUT);
	await mkdir(outputDirectory, { recursive: true });
	await clearKnownOutputs(outputDirectory);
	try {
		const repository = requiredText(environment.GITHUB_REPOSITORY, 'GITHUB_REPOSITORY');
		const token = requiredText(environment.GITHUB_TOKEN, 'GITHUB_TOKEN');
		const aggregationRunId = canonicalRunId(environment.GITHUB_RUN_ID, 'GITHUB_RUN_ID');
		const aggregationAttempt = positiveInteger(environment.GITHUB_RUN_ATTEMPT, 'GITHUB_RUN_ATTEMPT');
		const eventPath = resolve(repositoryRoot, requiredText(environment.GITHUB_EVENT_PATH, 'GITHUB_EVENT_PATH'));
		const event = JSON.parse(await readFile(eventPath, 'utf8'));
		const trigger = parsePromotionWorkflowRunEvent(event, repository);
		const reader = dependencies.createReader({ repository, token, fetchImpl });

		const aggregationInventory = await dependencies.collectInventory({
			reader,
			workflow: PROMOTION_AGGREGATION_WORKFLOW,
			event: 'workflow_run',
			branch: 'main',
		});
		const parentCandidates = await dependencies.createParentCandidates({
			reader,
			inventory: aggregationInventory,
			currentAggregationRunId: aggregationRunId,
			currentAggregationAttempt: aggregationAttempt,
		});
		const parentDiscovery = dependencies.discoverParent({ stage, candidates: parentCandidates });
		const parentLedger = parentDiscovery.parent?.ledger ?? null;

		const observationInventory = await dependencies.collectInventory({
			reader,
			workflow: PROMOTION_OBSERVATION_WORKFLOW,
			event: 'schedule',
			branch: 'main',
		});
		if (trigger.sourceEvent === 'schedule' && !observationInventory.some(run => run.runId === trigger.observationRunId)) {
			throw new Error(`triggered scheduled observation run ${trigger.observationRunId} is absent from the complete formal-run inventory`);
		}
		const selectedObservationInventory = selectInventoryForParent(observationInventory, parentLedger);
		const retainedRuns = parentLedger === null ? [] : parentLedger.runs.filter(run => selectedObservationInventory.some(item => item.runId === run.runId));
		const snapshots = await dependencies.createSnapshots({ reader, inventory: selectedObservationInventory, retainedRuns });
		const policy = JSON.parse(await readFile(resolve(repositoryRoot, policyPath), 'utf8'));
		const result = dependencies.orchestrate({
			stage,
			policy,
			trigger: { aggregationRunId, aggregationAttempt, observationRunId: trigger.observationRunId },
			...(parentLedger === null ? {} : { parent: parentLedger }),
			runs: snapshots,
		});

		const reportPath = resolve(outputDirectory, 'aggregation-report.json');
		await writeFile(reportPath, result.serializedReport, 'utf8');
		let ledgerPath = null;
		if (result.report.publish) {
			if (result.serializedLedger === null || result.ledgerSha256 === null) throw new Error('publish=true did not produce canonical ledger bytes');
			ledgerPath = resolve(outputDirectory, 'promotion-history-ledger.json');
			await writeFile(ledgerPath, result.serializedLedger, 'utf8');
		}
		await writeGitHubOutputs(environment.GITHUB_OUTPUT, {
			publish: String(result.report.publish),
			report_sha256: result.reportSha256,
			ledger_sha256: result.ledgerSha256 ?? '',
			current_generation: result.report.currentLedgerGeneration === null ? '' : String(result.report.currentLedgerGeneration),
		});
		return { ...result, reportPath, ledgerPath, parentDiscovery };
	} catch (error) {
		await rm(resolve(outputDirectory, 'aggregation-report.json'), { force: true });
		await rm(resolve(outputDirectory, 'promotion-history-ledger.json'), { force: true });
		const failure = {
			schemaVersion: 1,
			claim: 'selfhost-promotion-history-aggregation-failure',
			productionEligible: false,
			status: 'failed',
			errorName: error instanceof Error ? error.name : 'UnknownError',
			errorMessage: error instanceof Error ? error.message : String(error),
		};
		await writeFile(resolve(outputDirectory, 'aggregation-failure.json'), `${JSON.stringify(failure, null, 2)}\n`, 'utf8');
		throw error;
	}
}

export function selectInventoryForParent(inventory, parentLedger) {
	if (!Array.isArray(inventory)) throw new TypeError('inventory must be an array');
	if (parentLedger === null || parentLedger.runs.length === 0) return inventory;
	const parentByRunId = new Map(parentLedger.runs.map(run => [run.runId, run]));
	if (parentByRunId.size !== parentLedger.runs.length) throw new Error('retained ledger contains duplicate run IDs');
	const tail = parentLedger.runs.at(-1);
	if (!inventory.some(run => run.runId === tail.runId)) {
		throw new Error(`retained ledger tail run ${tail.runId} is absent from provider inventory`);
	}
	for (const run of inventory) {
		const retained = parentByRunId.get(run.runId) ?? null;
		if (retained !== null) {
			if (run.createdAt !== retained.sequenceAt || run.executionCommit !== retained.executionCommit) {
				throw new Error(`retained ledger run ${run.runId} disagrees with provider identity`);
			}
			continue;
		}
		if (compareRunKey(run, tail) <= 0) {
			throw new Error(`provider inventory contains historical run ${run.runId} absent from retained ledger`);
		}
	}
	return inventory;
}

export function parsePromotionWorkflowRunEvent(value, repository) {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('workflow_run event payload must be an object');
	if (value.action !== 'completed') throw new Error(`expected workflow_run action completed, received ${String(value.action)}`);
	if (value.repository?.full_name !== repository) throw new Error(`workflow_run repository must be ${repository}`);
	const run = value.workflow_run;
	if (run === null || typeof run !== 'object' || Array.isArray(run)) throw new Error('workflow_run payload is missing workflow_run object');
	if (run.name !== PROMOTION_OBSERVATION_WORKFLOW_NAME) throw new Error(`unexpected triggering workflow ${String(run.name)}`);
	if (run.path !== PROMOTION_OBSERVATION_WORKFLOW_PATH) throw new Error(`triggering workflow path must be ${PROMOTION_OBSERVATION_WORKFLOW_PATH}`);
	const observationRunId = canonicalRunId(run.id, 'workflow_run.id');
	if (run.head_branch !== 'main') throw new Error(`triggering observation must target main, received ${String(run.head_branch)}`);
	if (typeof run.head_sha !== 'string' || !/^[0-9a-f]{40}$/u.test(run.head_sha)) throw new Error('triggering observation head SHA is not canonical');
	if (run.event !== 'schedule' && run.event !== 'workflow_dispatch') throw new Error(`unexpected observation event ${String(run.event)}`);
	if (typeof run.conclusion !== 'string' || run.conclusion.length === 0 || run.conclusion.trim() !== run.conclusion) {
		throw new Error('completed triggering observation must have a canonical conclusion');
	}
	return { observationRunId, sourceEvent: run.event, conclusion: run.conclusion, executionCommit: run.head_sha };
}

async function clearKnownOutputs(outputDirectory) {
	await Promise.all(outputFiles.map(file => rm(resolve(outputDirectory, file), { force: true })));
}

async function writeGitHubOutputs(pathValue, values) {
	if (pathValue === undefined || pathValue === '') return;
	const path = resolve(pathValue);
	await mkdir(dirname(path), { recursive: true });
	const content = Object.entries(values).map(([key, value]) => `${key}=${value}\n`).join('');
	await writeFile(path, content, { encoding: 'utf8', flag: 'a' });
}

function compareRunKey(left, right) {
	const leftTime = left.createdAt ?? left.sequenceAt;
	const rightTime = right.createdAt ?? right.sequenceAt;
	if (leftTime !== rightTime) return leftTime < rightTime ? -1 : 1;
	const leftId = BigInt(left.runId);
	const rightId = BigInt(right.runId);
	return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
}

function canonicalRunId(value, path) {
	const text = typeof value === 'number' ? String(value) : value;
	if (typeof text !== 'string' || !runIdPattern.test(text)) throw new Error(`${path} must be a canonical positive decimal run ID`);
	return text;
}

function positiveInteger(value, path) {
	const text = typeof value === 'number' ? String(value) : value;
	if (typeof text !== 'string' || !/^[1-9][0-9]*$/u.test(text)) throw new Error(`${path} must be a positive integer`);
	const number = Number(text);
	if (!Number.isSafeInteger(number)) throw new Error(`${path} exceeds safe integer range`);
	return number;
}

function requiredText(value, path) {
	if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) throw new Error(`${path} is required`);
	return value;
}

const entry = process.argv[1] === undefined ? null : resolve(process.argv[1]);
if (entry === fileURLToPath(import.meta.url)) await runPromotionHistoryAggregation();