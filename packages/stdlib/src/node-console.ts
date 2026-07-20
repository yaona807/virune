import type { Unit } from '@virune/runtime';

export function print(message: string): Unit {
	console.log(message);
	return undefined;
}

export function error(message: string): Unit {
	console.error(message);
	return undefined;
}
