import { None, Some, type Option } from '@virune/runtime';

export const get = (key: string): Option<string> => {
	const value = globalThis.localStorage.getItem(key);
	return value === null ? None : Some(value);
};
export const set = (key: string, value: string): void => globalThis.localStorage.setItem(key, value);
export const remove = (key: string): void => globalThis.localStorage.removeItem(key);
export const clear = (): void => globalThis.localStorage.clear();
