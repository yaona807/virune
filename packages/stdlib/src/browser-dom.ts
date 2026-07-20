import { Err, Ok, toJsError, type JsError, type Result } from '@virune/runtime';

function element(selector: string): Result<Element, JsError> {
	try {
		const value = globalThis.document.querySelector(selector);
		return value === null ? Err({ kind: 'JsError', name: 'DomNotFoundError', message: `No element matches ${selector}` }) : Ok(value);
	} catch (error) { return Err(toJsError(error)); }
}

export function getText(selector: string): Result<string, JsError> {
	const value = element(selector);
	return value.$tag === 'Err' ? value : Ok(value.$values[0].textContent ?? '');
}

export function setText(selector: string, text: string): Result<undefined, JsError> {
	const value = element(selector);
	if (value.$tag === 'Err') return value;
	value.$values[0].textContent = text;
	return Ok(undefined);
}

export function setAttribute(selector: string, name: string, value: string): Result<undefined, JsError> {
	const target = element(selector);
	if (target.$tag === 'Err') return target;
	target.$values[0].setAttribute(name, value);
	return Ok(undefined);
}

export function addClass(selector: string, name: string): Result<undefined, JsError> {
	const target = element(selector);
	if (target.$tag === 'Err') return target;
	target.$values[0].classList.add(name);
	return Ok(undefined);
}
