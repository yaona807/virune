import { Err, Ok, toJsError, type JsError, type Result } from '@virune/runtime';

export const encodeComponent = (value: string): string => encodeURIComponent(value);
export function decodeComponent(value: string): Result<string, JsError> {
	try { return Ok(decodeURIComponent(value)); }
	catch (error) { return Err(toJsError(error)); }
}
export function isValid(value: string): boolean { return URL.canParse(value); }
