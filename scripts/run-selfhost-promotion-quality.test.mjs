import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { PROMOTION_QUALITY_COMMANDS, runSelfhostPromotionQuality } from './run-selfhost-promotion-quality.mjs';

function sha(value) { return createHash('sha256').update(value).digest('hex'); }

test('records every quality evidence id with canonical command, environment, and output hashes', async () => {
	const root = await mkdtemp(join(tmpdir(),'virune-promotion-quality-'));
	try {
		const calls = [];
		const result = await runSelfhostPromotionQuality({
			root,
			output:'quality.json',
			execute: async (argv, _cwd, environment) => {
				calls.push({ argv, environment });
				return { status:0, signal:null, error:null, stdout:`ok:${argv.join(' ')}`, stderr:'' };
			},
		});
		assert.equal(result.report.status,'passed');
		assert.deepEqual(result.report.evidence.map(item=>item.id), PROMOTION_QUALITY_COMMANDS.map(item=>item.id));
		assert.equal(calls.length, PROMOTION_QUALITY_COMMANDS.reduce((n,item)=>n+item.commands.length,0));
		for (const item of result.report.evidence) {
			const { sha256: claimed, ...record } = item;
			assert.equal(claimed,sha(JSON.stringify(record)));
			assert.equal(item.status,'passed');
			assert.ok(item.executions.every(execution => typeof execution.environment === 'object' && !Array.isArray(execution.environment)));
			assert.ok(item.executions.every(execution => typeof execution.nonzeroExitClassification === 'string'));
			assert.ok(item.executions.every(execution => execution.infrastructureFailed === false));
		}
		assert.equal(await readFile(join(root,'quality.json'),'utf8'),result.serialized);
	} finally { await rm(root,{recursive:true,force:true}); }
});

test('browser integration reproduces all three formal Playwright engine executions', () => {
	const group = PROMOTION_QUALITY_COMMANDS.find(item=>item.id==='browser-integration');
	assert.ok(group);
	assert.deepEqual(group.commands.map(item=>item.environment.VIRUNE_BROWSER_ENGINE),['chromium','firefox','webkit']);
	assert.ok(group.commands.every(item=>item.environment.VIRUNE_PLAYWRIGHT_MANAGED==='true'));
	assert.ok(group.commands.every(item=>item.nonzeroExitClassification==='infrastructure-unknown'));
	assert.ok(group.commands.every(item=>item.argv.join(' ')==='node --test --test-timeout=120000 integration/dist/browser.test.js'));
});

test('ambiguous managed-browser nonzero exit cannot become permanent product-failure evidence', async () => {
	const root = await mkdtemp(join(tmpdir(),'virune-promotion-quality-browser-infrastructure-'));
	try {
		const result = await runSelfhostPromotionQuality({ root, output:'quality.json', execute: async (_argv, _cwd, environment) => {
			if (environment.VIRUNE_BROWSER_ENGINE === 'chromium') {
				return {status:1,signal:null,error:null,stdout:'',stderr:'browser execution failed'};
			}
			return {status:0,signal:null,error:null,stdout:'ok',stderr:''};
		} });
		const browser = result.report.evidence.find(item=>item.id==='browser-integration');
		assert.ok(browser);
		assert.equal(result.report.status,'infrastructure-failed');
		assert.equal(browser.status,'infrastructure-failed');
		assert.equal(browser.executions.length,1);
		assert.equal(browser.executions[0].nonzeroExitClassification,'infrastructure-unknown');
		assert.equal(browser.executions[0].infrastructureFailed,true);
		assert.equal(browser.executions[0].passed,false);
	} finally { process.exitCode=0; await rm(root,{recursive:true,force:true}); }
});

test('fuzz regression combines repository regression tests with deterministic Self-host semantic differential fuzz', () => {
	const group = PROMOTION_QUALITY_COMMANDS.find(item=>item.id==='fuzz-regression');
	assert.ok(group);
	assert.deepEqual(group.commands[0].argv,['npm','run','test:fuzz']);
	assert.deepEqual(group.commands[1].argv,[
		'node','scripts/run-selfhost-semantic-differential-fuzz.mjs','--seed=1396983345','--iterations=64','--output=.cache/selfhost-promotion-semantic-fuzz',
	]);
});

test('stops later commands inside one evidence group after product failure but continues independent evidence groups', async () => {
	const root = await mkdtemp(join(tmpdir(),'virune-promotion-quality-failure-'));
	try {
		let count=0;
		const result = await runSelfhostPromotionQuality({ root, output:'quality.json', execute: async () => {
			count += 1;
			return count===1
				? {status:1,signal:null,error:null,stdout:'',stderr:'fail'}
				: {status:0,signal:null,error:null,stdout:'ok',stderr:''};
		} });
		assert.equal(result.report.status,'failed');
		assert.equal(result.report.evidence[0].status,'failed');
		assert.equal(result.report.evidence[0].executions.length,1);
		assert.equal(result.report.evidence[0].executions[0].nonzeroExitClassification,'product-failed');
		assert.equal(result.report.evidence[0].executions[0].infrastructureFailed,false);
		assert.ok(result.report.evidence.slice(1).every(item=>item.status==='passed'));
	} finally { process.exitCode=0; await rm(root,{recursive:true,force:true}); }
});

test('spawn failure is infrastructure-failed rather than permanent product evidence', async () => {
	const root = await mkdtemp(join(tmpdir(),'virune-promotion-quality-infrastructure-'));
	try {
		let count=0;
		const result = await runSelfhostPromotionQuality({ root, output:'quality.json', execute: async () => {
			count += 1;
			return count===1
				? {status:null,signal:null,error:'spawn ENOENT',stdout:'',stderr:''}
				: {status:0,signal:null,error:null,stdout:'ok',stderr:''};
		} });
		assert.equal(result.report.status,'infrastructure-failed');
		assert.equal(result.report.evidence[0].status,'infrastructure-failed');
		assert.equal(result.report.evidence[0].executions[0].infrastructureFailed,true);
		assert.equal(result.report.evidence[0].executions[0].passed,false);
		assert.equal(result.report.evidence[0].executions[0].errorSha256,sha('spawn ENOENT'));
		assert.ok(result.report.evidence.slice(1).every(item=>item.status==='passed'));
	} finally { process.exitCode=0; await rm(root,{recursive:true,force:true}); }
});

test('signal termination is infrastructure-failed and cannot be reported as a product failure', async () => {
	const root = await mkdtemp(join(tmpdir(),'virune-promotion-quality-signal-'));
	try {
		let count=0;
		const result = await runSelfhostPromotionQuality({ root, output:'quality.json', execute: async () => {
			count += 1;
			return count===1
				? {status:null,signal:'SIGKILL',error:null,stdout:'',stderr:''}
				: {status:0,signal:null,error:null,stdout:'ok',stderr:''};
		} });
		assert.equal(result.report.status,'infrastructure-failed');
		assert.equal(result.report.evidence[0].executions[0].signal,'SIGKILL');
		assert.equal(result.report.evidence[0].executions[0].infrastructureFailed,true);
	} finally { process.exitCode=0; await rm(root,{recursive:true,force:true}); }
});
