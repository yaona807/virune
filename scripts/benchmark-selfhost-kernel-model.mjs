import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const moduleUrl = `${pathToFileURL(resolve('selfhost/kernel/dist/main.js')).href}?benchmark=${Date.now()}`;
const kernel = await import(moduleUrl);
const strings = Array.from({ length: 400 }, (_, index) => `symbol-${String(399 - index).padStart(4, '0')}`);
const numbers = Array.from({ length: 400 }, (_, index) => 399 - index);
const iterations = Number.parseInt(process.env.VIRUNE_SELFHOST_BENCH_ITERATIONS ?? '100', 10);

const allocationStart = performance.now();
for (let index = 0; index < iterations; index += 1) {
	const result = kernel.runArenaProbe();
	if (result.$tag !== 'Ok') throw new Error('Arena benchmark probe failed');
}
const allocationMs = performance.now() - allocationStart;

const tableStart = performance.now();
let encodedBytes = 0;
for (let index = 0; index < iterations; index += 1) {
	const result = kernel.encodeCanonicalTables(strings, numbers);
	if (result.$tag !== 'Ok') throw new Error('Canonical table benchmark failed');
	encodedBytes += Buffer.byteLength(result.$values[0]);
}
const tableMs = performance.now() - tableStart;

const report = {
	schemaVersion: 1,
	iterations,
	valuesPerTable: strings.length,
	allocation: {
		totalMilliseconds: Number(allocationMs.toFixed(3)),
		operationsPerSecond: Number(((iterations / allocationMs) * 1000).toFixed(2)),
	},
	lookupAndSerialization: {
		totalMilliseconds: Number(tableMs.toFixed(3)),
		operationsPerSecond: Number(((iterations / tableMs) * 1000).toFixed(2)),
		encodedBytes,
	},
};

console.log(JSON.stringify(report, null, 2));
