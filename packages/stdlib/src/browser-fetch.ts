import { Err, Ok, toJsError, type JsError, type Result, type TaskContext } from '@virune/runtime';


export type HttpBody =
	| { readonly $tag: 'Empty'; readonly $values: readonly [] }
	| { readonly $tag: 'Text'; readonly $values: readonly [string] }
	| { readonly $tag: 'Bytes'; readonly $values: readonly [Uint8Array] };

const textBody = (value: string): HttpBody => ({ $tag: 'Text', $values: [value] });
const requestBody = (body: HttpBody): BodyInit | undefined => {
	switch (body.$tag) {
		case 'Empty': return undefined;
		case 'Text': return body.$values[0];
		case 'Bytes': return body.$values[0].slice().buffer as ArrayBuffer;
	}
};

export interface HttpResponse {
	readonly status: number;
	readonly ok: boolean;
	readonly body: HttpBody;
	readonly headers: ReadonlyMap<string, string>;
}

export async function request(
	url: string,
	method: string,
	headers: ReadonlyMap<string, string>,
	body: HttpBody,
	context: TaskContext,
): Promise<Result<HttpResponse, JsError>> {
	try {
		const init: RequestInit = { signal: context.signal, method, headers: Object.fromEntries(headers) };
		const content = requestBody(body);
		if (content !== undefined) init.body = content;
		const response = await fetch(url, init);
		return Ok({ status: response.status, ok: response.ok, body: textBody(await response.text()), headers: new Map(response.headers.entries()) });
	} catch (error) { return Err(toJsError(error)); }
}

export async function get(url: string, context: TaskContext): Promise<Result<HttpResponse, JsError>> {
	try {
		const response = await fetch(url, { signal: context.signal });
		return Ok({ status: response.status, ok: response.ok, body: textBody(await response.text()), headers: new Map(response.headers.entries()) });
	} catch (error) { return Err(toJsError(error)); }
}
