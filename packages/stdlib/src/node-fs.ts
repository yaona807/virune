import { readFile, writeFile } from 'node:fs/promises';
import { Err, Ok, toJsError, type JsError, type Result, type TaskContext } from '@virune/runtime';

export async function readText(path: string, context: TaskContext): Promise<Result<string, JsError>> {
	try {
		if (context.signal.aborted) throw context.signal.reason;
		return Ok(await readFile(path, { encoding: 'utf8', signal: context.signal }));
	} catch (error) { return Err(toJsError(error)); }
}

export async function readBytes(path: string, context: TaskContext): Promise<Result<Uint8Array, JsError>> {
	try {
		if (context.signal.aborted) throw context.signal.reason;
		return Ok(new Uint8Array(await readFile(path, { signal: context.signal })));
	} catch (error) { return Err(toJsError(error)); }
}

export async function writeBytes(path: string, content: Uint8Array, context: TaskContext): Promise<Result<undefined, JsError>> {
	try {
		if (context.signal.aborted) throw context.signal.reason;
		await writeFile(path, content, { signal: context.signal });
		return Ok(undefined);
	} catch (error) { return Err(toJsError(error)); }
}

export async function writeText(path: string, content: string, context: TaskContext): Promise<Result<undefined, JsError>> {
	try {
		if (context.signal.aborted) throw context.signal.reason;
		await writeFile(path, content, { encoding: 'utf8', signal: context.signal });
		return Ok(undefined);
	} catch (error) { return Err(toJsError(error)); }
}

export type FileHandle = import('node:fs/promises').FileHandle;

export async function openHandle(path: string, flags: string, context: TaskContext): Promise<Result<FileHandle, JsError>> {
	try {
		if (context.signal.aborted) throw context.signal.reason;
		const fs = await import('node:fs/promises');
		return Ok(await fs.open(path, flags));
	} catch (error) { return Err(toJsError(error)); }
}

export async function readHandle(handle: FileHandle, context: TaskContext): Promise<Result<string, JsError>> {
	try {
		if (context.signal.aborted) throw context.signal.reason;
		return Ok(await handle.readFile({ encoding: 'utf8', signal: context.signal }));
	} catch (error) { return Err(toJsError(error)); }
}

export async function writeHandle(handle: FileHandle, content: string, context: TaskContext): Promise<Result<undefined, JsError>> {
	try {
		if (context.signal.aborted) throw context.signal.reason;
		await handle.writeFile(content, { encoding: 'utf8', signal: context.signal });
		return Ok(undefined);
	} catch (error) { return Err(toJsError(error)); }
}


export async function readHandleBytes(handle: FileHandle, context: TaskContext): Promise<Result<Uint8Array, JsError>> {
	try {
		if (context.signal.aborted) throw context.signal.reason;
		return Ok(new Uint8Array(await handle.readFile({ signal: context.signal })));
	} catch (error) { return Err(toJsError(error)); }
}

export async function writeHandleBytes(handle: FileHandle, content: Uint8Array, context: TaskContext): Promise<Result<undefined, JsError>> {
	try {
		if (context.signal.aborted) throw context.signal.reason;
		await handle.writeFile(content, { signal: context.signal });
		return Ok(undefined);
	} catch (error) { return Err(toJsError(error)); }
}

export async function closeHandle(handle: FileHandle, context: TaskContext): Promise<Result<undefined, JsError>> {
	try {
		if (context.signal.aborted) throw context.signal.reason;
		await handle.close();
		return Ok(undefined);
	} catch (error) { return Err(toJsError(error)); }
}
