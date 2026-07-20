import { Err, Ok, type Result } from './core.js';
import type { Duration } from './duration.js';

export interface TaskContext { readonly signal: AbortSignal; }
export interface ParallelEntry<T> { readonly index: number; readonly run: (context: TaskContext) => Promise<T>; }
export interface RetryPolicy {
	readonly attempts: number;
	readonly delay: Duration;
	readonly backoffFactor?: number;
}
export interface SupervisorPolicy {
	readonly maxRestarts: number;
	readonly window: Duration;
	readonly delay?: Duration;
}

export class TaskTimeoutError extends Error {
	public constructor(readonly milliseconds: number) {
		super(`Task timed out after ${milliseconds}ms`);
		this.name = 'TaskTimeoutError';
	}
}

export class TaskCancelledError extends Error {
	public constructor(readonly reason: unknown) {
		super('Task was cancelled');
		this.name = 'TaskCancelledError';
	}
}

export class SupervisorRestartLimitError extends Error {
	public constructor(readonly restarts: number) {
		super(`Supervisor restart limit exceeded after ${restarts} restart(s)`);
		this.name = 'SupervisorRestartLimitError';
	}
}

export function rootTaskContext(signal?: AbortSignal): TaskContext {
	return { signal: signal ?? new AbortController().signal };
}

interface LinkedController {
	readonly controller: AbortController;
	dispose(): void;
}

function linkedController(parent: AbortSignal): LinkedController {
	const controller = new AbortController();
	const abort = () => controller.abort(parent.reason);
	if (parent.aborted) abort();
	else parent.addEventListener('abort', abort, { once: true });
	return { controller, dispose: () => parent.removeEventListener('abort', abort) };
}

function throwIfCancelled(context: TaskContext): void {
	if (context.signal.aborted) throw new TaskCancelledError(context.signal.reason);
}

export async function sleep(context: TaskContext, duration: Duration): Promise<void> {
	throwIfCancelled(context);
	await new Promise<void>((resolve, reject) => {
		const cleanup = (): void => context.signal.removeEventListener('abort', abort);
		const timer = setTimeout(() => { cleanup(); resolve(); }, duration.milliseconds);
		const abort = () => {
			clearTimeout(timer);
			cleanup();
			reject(new TaskCancelledError(context.signal.reason));
		};
		context.signal.addEventListener('abort', abort, { once: true });
	});
}

export async function parallel<T extends Record<string, (context: TaskContext) => Promise<unknown>>>(
	context: TaskContext,
	entries: T,
): Promise<{ readonly [K in keyof T]: Awaited<ReturnType<T[K]>> }> {
	throwIfCancelled(context);
	const linked = linkedController(context.signal);
	const childContext = { signal: linked.controller.signal };
	const names = Object.keys(entries) as (keyof T)[];
	try {
		const results = await Promise.allSettled(names.map(async name => {
			try {
				return await entries[name]!(childContext);
			} catch (error) {
				if (!linked.controller.signal.aborted) linked.controller.abort(error);
				throw error;
			}
		}));
		for (const result of results) {
			if (result.status === 'rejected') throw result.reason;
		}
		return Object.fromEntries(names.map((name, index) => {
			const result = results[index]!;
			if (result.status !== 'fulfilled') throw result.reason;
			return [name, result.value];
		})) as { readonly [K in keyof T]: Awaited<ReturnType<T[K]>> };
	} finally {
		linked.dispose();
	}
}

export async function parallelTry<T extends Record<string, (context: TaskContext) => Promise<Result<unknown, E>>>, E>(
	context: TaskContext,
	entries: T,
): Promise<Result<{ readonly [K in keyof T]: T[K] extends (context: TaskContext) => Promise<Result<infer V, E>> ? V : never }, E>> {
	throwIfCancelled(context);
	const linked = linkedController(context.signal);
	const childContext = { signal: linked.controller.signal };
	const names = Object.keys(entries) as (keyof T)[];
	type Outcome =
		| { readonly kind: 'result'; readonly index: number; readonly value: Result<unknown, E> }
		| { readonly kind: 'throw'; readonly index: number; readonly error: unknown }
		| { readonly kind: 'cancelled'; readonly index: number };
	try {
		const outcomes = await Promise.all(names.map(async (name, index): Promise<Outcome> => {
			try {
				const value = await Promise.resolve().then(() => entries[name]!(childContext));
				if (value.$tag === 'Err' && !linked.controller.signal.aborted) linked.controller.abort(value.$values[0]);
				return { kind: 'result', index, value };
			} catch (error) {
				const cancelled = linked.controller.signal.aborted && (
					error === linked.controller.signal.reason
					|| (error instanceof TaskCancelledError && error.reason === linked.controller.signal.reason)
				);
				if (cancelled) return { kind: 'cancelled', index };
				if (!linked.controller.signal.aborted) linked.controller.abort(error);
				return { kind: 'throw', index, error };
			}
		}));
		const thrown = outcomes.filter((outcome): outcome is Extract<Outcome, { kind: 'throw' }> => outcome.kind === 'throw');
		if (thrown.length > 0) {
			thrown.sort((left, right) => left.index - right.index);
			throw thrown[0]!.error;
		}
		const errors = outcomes
			.filter((outcome): outcome is Extract<Outcome, { kind: 'result' }> => outcome.kind === 'result' && outcome.value.$tag === 'Err')
			.sort((left, right) => left.index - right.index);
		if (errors.length > 0) return Err(errors[0]!.value.$values[0] as E);
		throwIfCancelled(context);
		const output = Object.fromEntries(names.map((name, index) => {
			const outcome = outcomes[index]!;
			if (outcome.kind !== 'result' || outcome.value.$tag !== 'Ok') throw new TaskCancelledError(linked.controller.signal.reason);
			return [name, outcome.value.$values[0]];
		}));
		return Ok(output as { readonly [K in keyof T]: T[K] extends (context: TaskContext) => Promise<Result<infer V, E>> ? V : never });
	} finally {
		linked.dispose();
	}
}

export async function withTimeout<T>(context: TaskContext, milliseconds: number, operation: (context: TaskContext) => Promise<T>): Promise<T> {
	throwIfCancelled(context);
	if (!Number.isFinite(milliseconds) || milliseconds < 0 || milliseconds > 2_147_483_647) {
		throw new RangeError('Task timeout must be a finite value between 0 and 2147483647 milliseconds');
	}
	const linked = linkedController(context.signal);
	const timeoutError = new TaskTimeoutError(milliseconds);
	const childContext = { signal: linked.controller.signal };
	const operationInFlight = Promise.resolve().then(() => operation(childContext));
	const timer = setTimeout(() => linked.controller.abort(timeoutError), milliseconds);
	let abortListener: (() => void) | undefined;
	try {
		const cancellation = new Promise<T>((_, reject) => {
			abortListener = () => {
				const reason = linked.controller.signal.reason;
				reject(reason instanceof TaskTimeoutError ? reason : new TaskCancelledError(reason));
			};
			linked.controller.signal.addEventListener('abort', abortListener, { once: true });
		});
		try {
			return await Promise.race([operationInFlight, cancellation]);
		} catch (error) {
			if (!linked.controller.signal.aborted) linked.controller.abort(error);
			await Promise.allSettled([operationInFlight]);
			throw error;
		}
	} finally {
		clearTimeout(timer);
		if (abortListener !== undefined) linked.controller.signal.removeEventListener('abort', abortListener);
		linked.dispose();
	}
}

export async function taskTimeout<T>(context: TaskContext, duration: Duration, operation: (context: TaskContext) => Promise<T>): Promise<Result<T, TaskTimeoutError>> {
	try { return Ok(await withTimeout(context, duration.milliseconds, operation)); }
	catch (error) {
		if (error instanceof TaskTimeoutError) return Err(error);
		throw error;
	}
}

export async function race<T>(context: TaskContext, operations: readonly ((context: TaskContext) => Promise<T>)[]): Promise<T> {
	if (operations.length === 0) throw new Error('Task.race requires at least one operation');
	throwIfCancelled(context);
	const linked = linkedController(context.signal);
	const childContext = { signal: linked.controller.signal };
	const operationsInFlight = operations.map(operation => Promise.resolve().then(() => operation(childContext)));
	try {
		const value = await Promise.race(operationsInFlight);
		linked.controller.abort('Task.race completed');
		await Promise.allSettled(operationsInFlight);
		return value;
	} catch (error) {
		linked.controller.abort(error);
		await Promise.allSettled(operationsInFlight);
		throw error;
	} finally {
		linked.dispose();
	}
}

export async function firstOk<T>(context: TaskContext, operations: readonly ((context: TaskContext) => Promise<T>)[]): Promise<T> {
	if (operations.length === 0) throw new Error('Task.firstOk requires at least one operation');
	throwIfCancelled(context);
	const linked = linkedController(context.signal);
	const childContext = { signal: linked.controller.signal };
	const operationsInFlight = operations.map(operation => Promise.resolve().then(() => operation(childContext)));
	try {
		const value = await Promise.any(operationsInFlight);
		linked.controller.abort('Task.firstOk completed');
		await Promise.allSettled(operationsInFlight);
		return value;
	} catch (error) {
		linked.controller.abort(error);
		await Promise.allSettled(operationsInFlight);
		throw error;
	} finally {
		linked.dispose();
	}
}

export async function retry<T, E>(
	context: TaskContext,
	policy: RetryPolicy,
	operation: (attempt: number, context: TaskContext) => Promise<Result<T, E>>,
): Promise<Result<T, E>> {
	const attempts = Math.max(1, Math.trunc(policy.attempts));
	let last: Result<T, E> | undefined;
	for (let attempt = 1; attempt <= attempts; attempt++) {
		throwIfCancelled(context);
		last = await operation(attempt, context);
		throwIfCancelled(context);
		if (last.$tag === 'Ok' || attempt === attempts) return last;
		const factor = policy.backoffFactor ?? 1;
		if (!Number.isFinite(factor) || factor < 0) throw new RangeError('Retry backoffFactor must be a finite non-negative number');
		const delay = policy.delay.milliseconds * factor ** (attempt - 1);
		if (!Number.isFinite(delay) || delay < 0 || delay > 2_147_483_647) throw new RangeError('Retry delay exceeds the supported timer range');
		await sleep(context, { milliseconds: delay });
	}
	return last as Result<T, E>;
}

export async function mapParallel<T, U>(
	context: TaskContext,
	values: readonly T[],
	limit: number,
	mapper: (value: T, index: number, context: TaskContext) => Promise<U>,
): Promise<readonly U[]> {
	throwIfCancelled(context);
	const concurrency = Math.max(1, Math.trunc(limit));
	const output = new Array<U>(values.length);
	const linked = linkedController(context.signal);
	const childContext = { signal: linked.controller.signal };
	let primaryFailure: { readonly index: number; readonly error: unknown } | undefined;
	let cursor = 0;
	const worker = async (): Promise<void> => {
		while (!childContext.signal.aborted) {
			const index = cursor++;
			if (index >= values.length) return;
			try {
				output[index] = await mapper(values[index] as T, index, childContext);
			} catch (error) {
				const cancellation = childContext.signal.aborted && (error === childContext.signal.reason || (error instanceof TaskCancelledError && error.reason === childContext.signal.reason));
				if (!cancellation && primaryFailure === undefined) primaryFailure = { index, error };
				if (!childContext.signal.aborted) linked.controller.abort(error);
				return;
			}
		}
	};
	try {
		await Promise.allSettled(Array.from({ length: Math.min(concurrency, values.length) }, worker));
		if (primaryFailure !== undefined) throw primaryFailure.error;
		throwIfCancelled(context);
		return output;
	} finally {
		linked.dispose();
	}
}

export async function supervise<T>(
	context: TaskContext,
	policy: SupervisorPolicy,
	operation: (context: TaskContext, restart: number) => Promise<T>,
): Promise<T> {
	const restartTimes: number[] = [];
	let restart = 0;
	while (true) {
		throwIfCancelled(context);
		try {
			return await operation(context, restart);
		} catch (error) {
			if (context.signal.aborted) throw new TaskCancelledError(context.signal.reason);
			const now = Date.now();
			while (restartTimes.length > 0 && now - (restartTimes[0] as number) > policy.window.milliseconds) restartTimes.shift();
			if (restartTimes.length >= policy.maxRestarts) throw new SupervisorRestartLimitError(restartTimes.length);
			restartTimes.push(now);
			restart++;
			if (policy.delay !== undefined) await sleep(context, policy.delay);
		}
	}
}


export const taskRace = race;
export const taskFirstOk = firstOk;
export async function taskRetry<T, E>(context: TaskContext, attempts: number, delay: Duration, operation: (attempt: number, context: TaskContext) => Promise<Result<T, E>>): Promise<Result<T, E>> {
	return retry(context, { attempts, delay }, operation);
}
export const taskMapParallel = mapParallel;

export const taskTimeoutBuiltin = <T>(duration: Duration, operation: (context: TaskContext) => Promise<T>, context: TaskContext): Promise<Result<T, TaskTimeoutError>> => taskTimeout(context, duration, operation);
export const taskRaceBuiltin = <T>(operations: readonly ((context: TaskContext) => Promise<T>)[], context: TaskContext): Promise<T> => taskRace(context, operations);
export const taskFirstOkBuiltin = <T>(operations: readonly ((context: TaskContext) => Promise<T>)[], context: TaskContext): Promise<T> => taskFirstOk(context, operations);
export const taskRetryBuiltin = <T, E>(attempts: number, delay: Duration, operation: (attempt: number, context: TaskContext) => Promise<Result<T, E>>, context: TaskContext): Promise<Result<T, E>> => taskRetry(context, attempts, delay, operation);
export const taskMapParallelBuiltin = <T, U>(values: readonly T[], limit: number, mapper: (value: T, index: number, context: TaskContext) => Promise<U>, context: TaskContext): Promise<readonly U[]> => taskMapParallel(context, values, limit, mapper);

export const taskSleepBuiltin = (duration: Duration, context: TaskContext): Promise<void> => sleep(context, duration);
export async function taskSuperviseBuiltin<T>(
	maxRestarts: number,
	window: Duration,
	delay: Duration,
	operation: (restart: number, context: TaskContext) => Promise<T>,
	context: TaskContext,
): Promise<Result<T, SupervisorRestartLimitError>> {
	try {
		return Ok(await supervise(context, { maxRestarts, window, delay }, (childContext, restart) => operation(restart, childContext)));
	} catch (error) {
		if (error instanceof SupervisorRestartLimitError) return Err(error);
		throw error;
	}
}
